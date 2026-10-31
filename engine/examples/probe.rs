use engine::board::*;
use engine::search::*;
use std::time::Instant;
fn main() {
    for cap in [20u32, 22, 24] {
        let mut s = Solver::with_table_bits(cap);
        let t = Instant::now();
        let r = s.best_line(start(parse_label("d5").unwrap()), UNLIMITED).map(|l| l.len());
        println!("cap {cap}: {r:?} nodes {} tt {} in {:.2}s", s.nodes(), s.tt_len(), t.elapsed().as_secs_f64());
    }
}
