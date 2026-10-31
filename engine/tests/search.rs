use engine::board::*;
use engine::search::*;

fn rng(seed: &mut u64) -> u64 {
    *seed ^= *seed >> 12;
    *seed ^= *seed << 25;
    *seed ^= *seed >> 27;
    seed.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

fn naive_value(p: Pos) -> u8 {
    moves(p).map(|m| naive_value(apply(p, m))).min().unwrap_or(p.count_ones() as u8)
}

fn bits(cells: &[&str]) -> Pos {
    cells.iter().map(|s| 1u64 << parse_label(s).unwrap()).fold(0, |a, b| a | b)
}

#[test]
fn two_adjacent_marbles_finish_with_one() {
    let mut s = Solver::new();
    assert_eq!(s.value(bits(&["d4", "e4"]), UNLIMITED), Ok(1));
}

#[test]
fn stranded_marbles_score_their_count() {
    let mut s = Solver::new();
    assert_eq!(s.value(bits(&["a4", "d4", "g4", "d7"]), UNLIMITED), Ok(4));
}

#[test]
fn search_matches_naive_minimax_on_small_positions() {
    let mut seed = 42u64;
    let mut s = Solver::new();
    for _ in 0..300 {
        // A random 9-marble position, usually with some jumps available.
        let mut p = 0u64;
        while p.count_ones() < 9 {
            p |= 1 << CELLS[(rng(&mut seed) % 37) as usize];
        }
        assert_eq!(s.value(p, UNLIMITED), Ok(naive_value(p)), "position {p:#x}");
    }
}

#[test]
fn best_line_is_legal_and_reaches_the_value() {
    let mut seed = 5u64;
    let mut s = Solver::new();
    for _ in 0..100 {
        let mut p = 0u64;
        while p.count_ones() < 12 {
            p |= 1 << CELLS[(rng(&mut seed) % 37) as usize];
        }
        let v = s.value(p, UNLIMITED).unwrap();
        let line = s.best_line(p, UNLIMITED).unwrap();
        let mut q = p;
        for m in &line {
            assert!(moves(q).any(|x| x == *m), "illegal move in line");
            q = apply(q, *m);
        }
        assert!(!has_moves(q));
        assert_eq!(q.count_ones() as u8, v);
    }
}

#[test]
fn d5_and_e7_starts_solve_to_one_marble() {
    let mut s = Solver::new();
    for hole in ["d5", "e7"] {
        let line = s.best_line(start(parse_label(hole).unwrap()), UNLIMITED).unwrap();
        assert_eq!(line.len(), 35, "{hole} should finish with a single marble");
    }
}

#[test]
fn budget_runs_out_cleanly() {
    let mut s = Solver::new();
    assert_eq!(s.value(start(CENTRE), 1_000), Err(OutOfBudget));
}

#[test]
fn grade_moves_marks_exactly_the_moves_that_keep_the_value() {
    let mut seed = 77u64;
    let mut s = Solver::new();
    for _ in 0..60 {
        let mut p = 0u64;
        while p.count_ones() < 11 {
            p |= 1 << CELLS[(rng(&mut seed) % 37) as usize];
        }
        let (v, graded) = s.grade_moves(p, UNLIMITED).unwrap();
        assert_eq!(v, naive_value(p));
        for (m, good) in graded {
            assert_eq!(good, naive_value(apply(p, m)) == v, "move {m:?} in {p:#x}");
        }
    }
}
