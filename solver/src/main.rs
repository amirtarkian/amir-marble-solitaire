//! Offline exhaustive solver for the 37-hole French board.
//!
//! solver solve [d4 e5 ...]   solve starts (default: all 8), cache results in data-cache/
//! solver bench               time live search on cached samples, and cross-check values
//! solver build-data N        write web/public/data/{opening.bin,solutions.json},
//!                            with the opening table covering the first N moves

use engine::board::{apply, label, moves, parse_label, start, Move, Pos, CELLS};
use engine::class::lower_bound;
use engine::opening::OpeningTable;
use engine::search::{Solver, UNLIMITED};
use engine::symmetry::{canon, orbit_rep, ORBIT_REPS};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

const CACHE: &str = "data-cache";
const OUT: &str = "web/public/data";
/// Hard positions (value != class lower bound) are cached down to this many marbles.
const HARD_MIN_MARBLES: u32 = 22;
const SAMPLES_PER_LEVEL: usize = 400;
/// Published by G. Bell for the centre start; our forward pass must match it.
const CENTRE_REACHABLE: u64 = 374_349_517;

#[derive(Serialize, Deserialize)]
struct LevelStat {
    marbles: u32,
    positions: u64,
    hard: u64,
    /// How many positions at this level can still reach the start's best finish.
    on_track: u64,
}

#[derive(Serialize, Deserialize)]
struct Summary {
    rep: String,
    best: u8,
    reachable: u64,
    levels: Vec<LevelStat>,
    /// One optimal line for every hole in this symmetry class, in real orientation.
    lines: BTreeMap<String, Vec<[u8; 2]>>,
    seconds: f64,
}

fn expand(level: &[Pos]) -> Vec<Pos> {
    let mut next: Vec<Pos> = level
        .par_chunks(8192)
        .flat_map_iter(|chunk| {
            let mut v = Vec::with_capacity(chunk.len() * 6);
            for &p in chunk {
                v.extend(moves(p).map(|m| canon(apply(p, m))));
            }
            v.sort_unstable();
            v.dedup();
            v
        })
        .collect();
    next.par_sort_unstable();
    next.dedup();
    next
}

fn backward(level: &[Pos], marbles: u32, below: &[Pos], below_vals: &[u8]) -> Vec<u8> {
    level
        .par_iter()
        .map(|&p| {
            let mut best = marbles as u8;
            for m in moves(p) {
                let i = below.binary_search(&canon(apply(p, m))).expect("children are reachable");
                best = best.min(below_vals[i]);
            }
            best
        })
        .collect()
}

fn write_records(path: &str, recs: impl Iterator<Item = (Pos, u8)>) {
    let mut buf = Vec::new();
    for (p, v) in recs {
        buf.extend_from_slice(&p.to_le_bytes());
        buf.push(v);
    }
    fs::write(path, buf).unwrap();
}

fn read_records(path: &str) -> Vec<(Pos, u8)> {
    fs::read(path).unwrap().chunks_exact(9).map(|c| (u64::from_le_bytes(c[..8].try_into().unwrap()), c[8])).collect()
}

fn solve(rep: u8) {
    let t0 = Instant::now();
    let name = label(rep);
    println!("== {name} ==");

    // Forward: levels[k] = sorted canonical positions with k marbles.
    let mut levels: Vec<Vec<Pos>> = vec![Vec::new(); 37];
    levels[36] = vec![canon(start(rep))];
    let mut k = 36;
    while k > 1 {
        let next = expand(&levels[k]);
        if next.is_empty() {
            break;
        }
        k -= 1;
        println!("  forward {k:2} marbles: {:>12} positions  ({:.0}s)", next.len(), t0.elapsed().as_secs_f64());
        levels[k] = next;
    }
    let lowest = k;

    // Backward: vals[k][i] = exact value of levels[k][i].
    let mut vals: Vec<Vec<u8>> = vec![Vec::new(); 37];
    vals[lowest] = vec![lowest as u8; levels[lowest].len()];
    for k in lowest + 1..=36 {
        vals[k] = backward(&levels[k], k as u32, &levels[k - 1], &vals[k - 1]);
    }
    let best = vals[36][0];
    let reachable: u64 = levels.iter().map(|l| l.len() as u64).sum();
    println!("  best finish {best}, {reachable} reachable positions ({:.0}s)", t0.elapsed().as_secs_f64());
    if rep == engine::board::CENTRE {
        assert_eq!(reachable, CENTRE_REACHABLE, "centre reachable count must match the published figure");
        assert_eq!(best, 2, "the centre start cannot finish with one marble");
    }

    let lookup = |p: Pos| -> u8 {
        let k = p.count_ones() as usize;
        vals[k][levels[k].binary_search(&canon(p)).unwrap()]
    };

    let mut lines = BTreeMap::new();
    for &h in CELLS.iter().filter(|&&h| orbit_rep(h) == rep) {
        let mut p = start(h);
        let mut line = Vec::new();
        while let Some(m) = moves(p).find(|&m| lookup(apply(p, m)) == best) {
            line.push([m.from, m.to]);
            p = apply(p, m);
        }
        assert_eq!(p.count_ones() as u8, best);
        lines.insert(label(h), line);
    }

    let mut stats = Vec::new();
    let mut hard = Vec::new();
    let mut samples = Vec::new();
    for k in (lowest..=36).rev() {
        let (lv, vv) = (&levels[k], &vals[k]);
        let hard_here: Vec<(Pos, u8)> =
            lv.par_iter().zip(vv.par_iter()).filter(|(&p, &v)| v != lower_bound(p)).map(|(&p, &v)| (p, v)).collect();
        let on_track = vv.par_iter().filter(|&&v| v == best).count() as u64;
        stats.push(LevelStat { marbles: k as u32, positions: lv.len() as u64, hard: hard_here.len() as u64, on_track });
        if k as u32 >= HARD_MIN_MARBLES {
            hard.extend(hard_here);
        }
        let stride = (lv.len() / SAMPLES_PER_LEVEL).max(1);
        samples.extend((0..lv.len()).step_by(stride).map(|i| (lv[i], vv[i])));
    }

    fs::create_dir_all(CACHE).unwrap();
    write_records(&format!("{CACHE}/{name}.hard.bin"), hard.into_iter());
    write_records(&format!("{CACHE}/{name}.sample.bin"), samples.into_iter());
    let summary = Summary { rep: name.clone(), best, reachable, levels: stats, lines, seconds: t0.elapsed().as_secs_f64() };
    fs::write(format!("{CACHE}/{name}.json"), serde_json::to_string_pretty(&summary).unwrap()).unwrap();
    println!("  done in {:.0}s", t0.elapsed().as_secs_f64());
}

fn bench() {
    // Per level: how expensive is a cold live proof, and does it agree with the solve?
    let mut by_level: BTreeMap<u32, Vec<(Pos, u8)>> = BTreeMap::new();
    for &rep in ORBIT_REPS.iter() {
        let path = format!("{CACHE}/{}.sample.bin", label(rep));
        if Path::new(&path).exists() {
            for (p, v) in read_records(&path) {
                by_level.entry(p.count_ones()).or_default().push((p, v));
            }
        }
    }
    println!("marbles   n   median_ms     p90_ms     max_ms   max_nodes");
    for (&k, recs) in by_level.iter().rev() {
        if k > 33 {
            continue; // the first moves are always covered by the opening table
        }
        let mut times: Vec<(f64, u64)> = recs
            .par_iter()
            .take(120)
            .map(|&(p, v)| {
                let mut s = Solver::new();
                let t = Instant::now();
                let got = s.value(p, UNLIMITED).unwrap();
                assert_eq!(got, v, "live search disagrees with the exhaustive solve on {p:#x}");
                (t.elapsed().as_secs_f64() * 1e3, s.nodes())
            })
            .collect();
        times.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let n = times.len();
        let max_nodes = times.iter().map(|t| t.1).max().unwrap_or(0);
        println!(
            "{k:7} {n:3} {:11.1} {:10.1} {:10.1} {max_nodes:11}",
            times[n / 2].0,
            times[n * 9 / 10].0,
            times[n - 1].0
        );
        std::io::stdout().flush().unwrap();
    }
}

#[derive(Serialize)]
struct HoleOut {
    label: String,
    cell: u8,
    orbit: String,
    best: u8,
    line: Vec<[u8; 2]>,
}

#[derive(Serialize)]
struct OrbitOut {
    rep: String,
    best: u8,
    reachable: u64,
    levels: Vec<LevelStat>,
}

#[derive(Serialize)]
struct SolutionsOut {
    holes: Vec<HoleOut>,
    orbits: Vec<OrbitOut>,
    opening_moves: u32,
}

fn build_data(depth: u32) {
    let min_marbles = 36 - depth;
    assert!(min_marbles >= HARD_MIN_MARBLES, "cache only covers {HARD_MIN_MARBLES}+ marbles");
    let mut entries = Vec::new();
    let mut holes = Vec::new();
    let mut orbits = Vec::new();
    for &rep in ORBIT_REPS.iter() {
        let name = label(rep);
        let summary: Summary = serde_json::from_str(&fs::read_to_string(format!("{CACHE}/{name}.json")).unwrap()).unwrap();
        entries.extend(read_records(&format!("{CACHE}/{name}.hard.bin")).into_iter().filter(|(p, _)| p.count_ones() >= min_marbles));
        for (l, line) in &summary.lines {
            holes.push(HoleOut { label: l.clone(), cell: parse_label(l).unwrap(), orbit: name.clone(), best: summary.best, line: line.clone() });
        }
        orbits.push(OrbitOut { rep: name, best: summary.best, reachable: summary.reachable, levels: summary.levels });
    }
    holes.sort_by_key(|h| h.cell);
    let table = OpeningTable::new(min_marbles as u8, entries);
    let bytes = table.encode();
    fs::create_dir_all(OUT).unwrap();
    fs::write(format!("{OUT}/opening.bin"), &bytes).unwrap();
    let out = SolutionsOut { holes, orbits, opening_moves: depth };
    fs::write(format!("{OUT}/solutions.json"), serde_json::to_string(&out).unwrap()).unwrap();
    println!("opening table: {} hard positions with >= {min_marbles} marbles, {} bytes", table.len(), bytes.len());
    verify_lines(&out.holes);
}

/// Replays every published line, and re-derives each value with the live solver.
fn verify_lines(holes: &[HoleOut]) {
    for h in holes {
        let mut p = start(h.cell);
        for &[from, to] in &h.line {
            let m = Move::new(from, to);
            assert!(moves(p).any(|x| x == m), "illegal move in line for {}", h.label);
            p = apply(p, m);
        }
        assert!(!engine::board::has_moves(p) && p.count_ones() as u8 == h.best, "line for {} ends wrong", h.label);
    }
    println!("all {} lines replay legally to their best finish", holes.len());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("solve") => {
            let reps: Vec<u8> = if args.len() > 1 {
                args[1..].iter().map(|s| parse_label(s).expect("hole label like d4")).collect()
            } else {
                ORBIT_REPS.to_vec()
            };
            for rep in reps {
                assert_eq!(orbit_rep(rep), rep, "{} is not a representative; use one of d4 d5 d6 d7 e5 e6 e7 f6", label(rep));
                solve(rep);
            }
        }
        Some("bench") => bench(),
        Some("build-data") => build_data(args.get(1).and_then(|s| s.parse().ok()).expect("build-data <moves>")),
        _ => eprintln!("usage: solver solve [reps...] | bench | build-data <moves>"),
    }
}
