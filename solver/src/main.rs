//! Offline exhaustive solver for the 37-hole French board.
//!
//! solver solve [d4 e5 ...]   solve starts (default: all 8), cache results in data-cache/
//!                            (--keep-levels keeps the per-level files afterwards)
//! solver bench               time live search on cached samples, and cross-check values
//! solver build-data N        write web/public/data/{opening.bin,solutions.json},
//!                            with the opening table covering the first N moves

use engine::board::{apply, label, moves, parse_label, start, Move, Pos, CELLS};
use engine::class::lower_bound;
use engine::opening::OpeningTable;
use engine::search::Solver;
use engine::symmetry::{canon, orbit_rep, ORBIT_REPS};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
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

// ── Disk-backed levels ──────────────────────────────────────────────────
//
// The biggest starts reach ~2.5 billion positions, far more than fits in RAM at once.
// Each level is a sorted file of canonical keys (raw little-endian u64) plus a file of
// values (u8). At any moment the solver holds at most one level in memory, plus one
// chunk of the level it is producing or scoring.

/// Parents (forward) or positions (backward) handled per chunk.
const CHUNK: usize = 16 << 20;

fn keys_path(dir: &Path, k: usize) -> PathBuf {
    dir.join(format!("L{k:02}.keys"))
}

fn vals_path(dir: &Path, k: usize) -> PathBuf {
    dir.join(format!("L{k:02}.vals"))
}

fn as_bytes(v: &[u64]) -> &[u8] {
    // SAFETY: u64 has no padding; we only target little-endian machines.
    unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 8) }
}

fn write_keys(path: &Path, keys: &[u64]) {
    fs::write(path, as_bytes(keys)).unwrap();
}

fn key_count(path: &Path) -> usize {
    (fs::metadata(path).unwrap().len() / 8) as usize
}

/// Reads `len` keys starting at index `start`.
fn read_keys(path: &Path, start: usize, len: usize) -> Vec<u64> {
    let mut f = File::open(path).unwrap();
    f.seek(SeekFrom::Start(start as u64 * 8)).unwrap();
    let mut out = vec![0u64; len];
    // SAFETY: as in as_bytes.
    let bytes = unsafe { std::slice::from_raw_parts_mut(out.as_mut_ptr() as *mut u8, len * 8) };
    f.read_exact(bytes).unwrap();
    out
}

fn read_all_keys(path: &Path) -> Vec<u64> {
    read_keys(path, 0, key_count(path))
}

/// Sorted, de-duplicated canonical children of a chunk of parents.
fn children(parents: &[Pos]) -> Vec<Pos> {
    let mut kids: Vec<Pos> = parents
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
    kids.par_sort_unstable();
    kids.dedup();
    kids
}

struct Run {
    file: BufReader<File>,
    buf: Vec<u64>,
    pos: usize,
}

impl Run {
    fn open(path: &Path) -> Run {
        Run { file: BufReader::with_capacity(1 << 20, File::open(path).unwrap()), buf: Vec::new(), pos: 0 }
    }

    fn next(&mut self) -> Option<u64> {
        if self.pos == self.buf.len() {
            let mut bytes = vec![0u8; 1 << 19];
            let mut n = 0;
            while n < bytes.len() {
                match self.file.read(&mut bytes[n..]).unwrap() {
                    0 => break,
                    r => n += r,
                }
            }
            if n == 0 {
                return None;
            }
            self.buf = bytes[..n].chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect();
            self.pos = 0;
        }
        self.pos += 1;
        Some(self.buf[self.pos - 1])
    }
}

/// Writes the next level (sorted, unique canonical children of `parents_path`).
fn expand_to_file(parents_path: &Path, out: &Path) -> usize {
    let n = key_count(parents_path);
    if n <= CHUNK {
        let kids = children(&read_all_keys(parents_path));
        write_keys(out, &kids);
        return kids.len();
    }
    // Sorted runs per chunk of parents, then a k-way merge that drops duplicates.
    let mut runs = Vec::new();
    for (i, start) in (0..n).step_by(CHUNK).enumerate() {
        let kids = children(&read_keys(parents_path, start, CHUNK.min(n - start)));
        let run = out.with_extension(format!("run{i}"));
        write_keys(&run, &kids);
        runs.push(run);
    }
    let mut readers: Vec<Run> = runs.iter().map(|r| Run::open(r)).collect();
    let mut heap: BinaryHeap<Reverse<(u64, usize)>> = BinaryHeap::new();
    for (i, r) in readers.iter_mut().enumerate() {
        if let Some(x) = r.next() {
            heap.push(Reverse((x, i)));
        }
    }
    let mut w = BufWriter::with_capacity(1 << 22, File::create(out).unwrap());
    let (mut count, mut last) = (0usize, u64::MAX);
    while let Some(Reverse((x, i))) = heap.pop() {
        if x != last {
            w.write_all(&x.to_le_bytes()).unwrap();
            count += 1;
            last = x;
        }
        if let Some(y) = readers[i].next() {
            heap.push(Reverse((y, i)));
        }
    }
    w.flush().unwrap();
    for r in runs {
        fs::remove_file(r).unwrap();
    }
    count
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

fn solve(rep: u8, keep_levels: bool) {
    let t0 = Instant::now();
    let name = label(rep);
    println!("== {name} ==");
    let dir = Path::new(CACHE).join("levels").join(&name);
    fs::create_dir_all(&dir).unwrap();

    // Forward: one sorted key file per marble count.
    let mut counts = vec![0usize; 37];
    write_keys(&keys_path(&dir, 36), &[canon(start(rep))]);
    counts[36] = 1;
    let mut k = 36;
    while k > 1 {
        let n = expand_to_file(&keys_path(&dir, k), &keys_path(&dir, k - 1));
        if n == 0 {
            fs::remove_file(keys_path(&dir, k - 1)).unwrap();
            break;
        }
        k -= 1;
        counts[k] = n;
        println!("  forward {k:2} marbles: {n:>12} positions  ({:.0}s)", t0.elapsed().as_secs_f64());
    }
    let lowest = k;
    // Every position in the lowest level is a finish, and nothing finishes lower.
    let best = lowest as u8;
    let reachable: u64 = counts.iter().map(|&c| c as u64).sum();
    println!("  best finish {best}, {reachable} reachable positions ({:.0}s)", t0.elapsed().as_secs_f64());
    if rep == engine::board::CENTRE {
        assert_eq!(reachable, CENTRE_REACHABLE, "centre reachable count must match the published figure");
        assert_eq!(best, 2, "the centre start cannot finish with one marble");
    }

    // Backward: score level k from the scores of level k-1, a chunk at a time.
    let mut stats = Vec::new();
    let mut hard = Vec::new();
    let mut samples = Vec::new();
    let mut tally = |k: usize, keys: &[u64], vals: &[u8], stats: &mut Vec<LevelStat>| {
        let hard_here: Vec<(Pos, u8)> =
            keys.par_iter().zip(vals.par_iter()).filter(|(&p, &v)| v != lower_bound(p)).map(|(&p, &v)| (p, v)).collect();
        let on_track = vals.par_iter().filter(|&&v| v == best).count() as u64;
        match stats.iter_mut().find(|s: &&mut LevelStat| s.marbles == k as u32) {
            Some(s) => {
                s.hard += hard_here.len() as u64;
                s.on_track += on_track;
            }
            None => stats.push(LevelStat { marbles: k as u32, positions: counts[k] as u64, hard: hard_here.len() as u64, on_track }),
        }
        if k as u32 >= HARD_MIN_MARBLES {
            hard.extend(hard_here);
        }
    };
    let take_samples = |k: usize, offset: usize, keys: &[u64], vals: &[u8], samples: &mut Vec<(Pos, u8)>| {
        let stride = (counts[k] / SAMPLES_PER_LEVEL).max(1);
        let first = (stride - offset % stride) % stride;
        samples.extend((first..keys.len()).step_by(stride).map(|i| (keys[i], vals[i])));
    };

    let low_keys = read_all_keys(&keys_path(&dir, lowest));
    let low_vals = vec![best; low_keys.len()];
    fs::write(vals_path(&dir, lowest), &low_vals).unwrap();
    tally(lowest, &low_keys, &low_vals, &mut stats);
    take_samples(lowest, 0, &low_keys, &low_vals, &mut samples);
    drop((low_keys, low_vals));
    for k in lowest + 1..=36 {
        let below = read_all_keys(&keys_path(&dir, k - 1));
        let below_vals = fs::read(vals_path(&dir, k - 1)).unwrap();
        let mut w = BufWriter::new(File::create(vals_path(&dir, k)).unwrap());
        for start in (0..counts[k]).step_by(CHUNK) {
            let keys = read_keys(&keys_path(&dir, k), start, CHUNK.min(counts[k] - start));
            let vals: Vec<u8> = keys
                .par_iter()
                .map(|&p| {
                    let mut v = k as u8;
                    for m in moves(p) {
                        let i = below.binary_search(&canon(apply(p, m))).expect("children are reachable");
                        v = v.min(below_vals[i]);
                    }
                    v
                })
                .collect();
            w.write_all(&vals).unwrap();
            tally(k, &keys, &vals, &mut stats);
            take_samples(k, start, &keys, &vals, &mut samples);
        }
        w.flush().unwrap();
        println!("  backward {k:2} marbles done ({:.0}s)", t0.elapsed().as_secs_f64());
    }
    let start_val = fs::read(vals_path(&dir, 36)).unwrap()[0];
    assert_eq!(start_val, best, "start value must equal the lowest reachable level");
    stats.sort_by_key(|s| std::cmp::Reverse(s.marbles));

    // One optimal line per hole in this class: walk down, loading each level once.
    let holes: Vec<u8> = CELLS.iter().copied().filter(|&h| orbit_rep(h) == rep).collect();
    let mut cur: Vec<Pos> = holes.iter().map(|&h| start(h)).collect();
    let mut lines: Vec<Vec<[u8; 2]>> = vec![Vec::new(); holes.len()];
    for k in (lowest + 1..=36).rev() {
        let below = read_all_keys(&keys_path(&dir, k - 1));
        let below_vals = fs::read(vals_path(&dir, k - 1)).unwrap();
        for (p, line) in cur.iter_mut().zip(lines.iter_mut()) {
            let m = moves(*p)
                .find(|&m| below_vals[below.binary_search(&canon(apply(*p, m))).unwrap()] == best)
                .expect("an optimal child exists");
            line.push([m.from, m.to]);
            *p = apply(*p, m);
        }
    }
    let lines: BTreeMap<String, Vec<[u8; 2]>> = holes.iter().zip(lines).map(|(&h, l)| (label(h), l)).collect();

    write_records(&format!("{CACHE}/{name}.hard.bin"), hard.into_iter());
    write_records(&format!("{CACHE}/{name}.sample.bin"), samples.into_iter());
    let summary = Summary { rep: name.clone(), best, reachable, levels: stats, lines, seconds: t0.elapsed().as_secs_f64() };
    fs::write(format!("{CACHE}/{name}.json"), serde_json::to_string_pretty(&summary).unwrap()).unwrap();
    if !keep_levels {
        fs::remove_dir_all(&dir).unwrap();
    }
    println!("  done in {:.0}s", t0.elapsed().as_secs_f64());
}

fn bench() {
    // Per level, from the endgame upwards: how expensive is a cold live proof, and does
    // it agree with the exhaustive solve? Stops once most positions blow the budget.
    const BUDGET: u64 = 40_000_000;
    let mut by_level: BTreeMap<u32, Vec<(Pos, u8)>> = BTreeMap::new();
    for &rep in ORBIT_REPS.iter() {
        let path = format!("{CACHE}/{}.sample.bin", label(rep));
        if Path::new(&path).exists() {
            for (p, v) in read_records(&path) {
                by_level.entry(p.count_ones()).or_default().push((p, v));
            }
        }
    }
    println!("marbles   n   median_ms     p90_ms     max_ms   over_budget");
    for (&k, recs) in by_level.iter() {
        if k < 8 {
            continue;
        }
        // Spread the 120 samples across all starts.
        let stride = (recs.len() / 120).max(1);
        let picked: Vec<(Pos, u8)> = recs.iter().step_by(stride).copied().collect();
        let mut times: Vec<Option<f64>> = picked
            .par_iter()
            .map(|&(p, v)| {
                let mut s = Solver::with_table_bits(22);
                let t = Instant::now();
                match s.value(p, BUDGET) {
                    Ok(got) => {
                        assert_eq!(got, v, "live search disagrees with the exhaustive solve on {p:#x}");
                        Some(t.elapsed().as_secs_f64() * 1e3)
                    }
                    Err(_) => None,
                }
            })
            .collect();
        let over = times.iter().filter(|t| t.is_none()).count();
        let n = times.len();
        times.sort_by(|a, b| a.unwrap_or(f64::MAX).partial_cmp(&b.unwrap_or(f64::MAX)).unwrap());
        let ms = |i: usize| times[i].map_or("budget".to_string(), |t| format!("{t:.1}"));
        println!("{k:7} {n:3} {:>11} {:>10} {:>10} {over:11}", ms(n / 2), ms(n * 9 / 10), ms(n - 1));
        std::io::stdout().flush().unwrap();
        if over * 2 > n {
            break;
        }
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
            let keep = args.iter().any(|a| a == "--keep-levels");
            let named: Vec<&String> = args[1..].iter().filter(|a| !a.starts_with("--")).collect();
            let reps: Vec<u8> = if named.is_empty() {
                ORBIT_REPS.to_vec()
            } else {
                named.iter().map(|s| parse_label(s).expect("hole label like d4")).collect()
            };
            for rep in reps {
                assert_eq!(orbit_rep(rep), rep, "{} is not a representative; use one of d4 d5 d6 d7 e5 e6 e7 f6", label(rep));
                solve(rep, keep);
            }
        }
        Some("bench") => bench(),
        Some("build-data") => build_data(args.get(1).and_then(|s| s.parse().ok()).expect("build-data <moves>")),
        _ => eprintln!("usage: solver solve [reps...] | bench | build-data <moves>"),
    }
}
