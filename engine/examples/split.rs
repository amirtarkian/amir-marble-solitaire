// Where does live-search time go at one level: proving bad positions, or finding lines
// from good ones? Usage: split <marbles> (reads data-cache/*.sample.bin)
use engine::class::lower_bound;
use engine::search::Solver;
use std::time::Instant;
fn main() {
    let k: u32 = std::env::args().nth(1).unwrap().parse().unwrap();
    let mut recs = Vec::new();
    for rep in ["d4", "d5", "d6", "e5"] {
        let b = std::fs::read(format!("data-cache/{rep}.sample.bin")).unwrap();
        for c in b.chunks_exact(9) {
            let p = u64::from_le_bytes(c[..8].try_into().unwrap());
            if p.count_ones() == k { recs.push((p, c[8])); }
        }
    }
    let (mut good, mut hard) = (vec![], vec![]);
    for &(p, v) in recs.iter().take(160) {
        let mut s = Solver::with_table_bits(23);
        let t = Instant::now();
        assert_eq!(s.value(p, u64::MAX).unwrap(), v);
        let ms = t.elapsed().as_secs_f64() * 1e3;
        if v == lower_bound(p) { good.push((ms, s.nodes())) } else { hard.push((ms, s.nodes())) }
    }
    for (name, mut xs) in [("good", good), ("hard", hard)] {
        xs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let n = xs.len();
        if n == 0 { continue; }
        let tot: f64 = xs.iter().map(|x| x.0).sum();
        println!("{name}: n={n} median={:.1}ms p90={:.1}ms max={:.1}ms total={:.0}ms max_nodes={}", xs[n/2].0, xs[n*9/10].0, xs[n-1].0, tot, xs.iter().map(|x| x.1).max().unwrap());
    }
}
