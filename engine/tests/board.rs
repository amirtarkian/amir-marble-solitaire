use engine::board::*;

fn rng(seed: &mut u64) -> u64 {
    // xorshift64*
    *seed ^= *seed >> 12;
    *seed ^= *seed << 25;
    *seed ^= *seed >> 27;
    seed.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

fn brute_moves(p: Pos) -> Vec<Move> {
    let mut out = Vec::new();
    for from in 0..49u8 {
        let (r, c) = ((from / 7) as i32, (from % 7) as i32);
        for (dr, dc) in [(0, 1), (0, -1), (1, 0), (-1, 0)] {
            let (r1, c1, r2, c2) = (r + dr, c + dc, r + 2 * dr, c + 2 * dc);
            if !(0..7).contains(&r2) || !(0..7).contains(&c2) {
                continue;
            }
            let over = (r1 * 7 + c1) as u8;
            let to = (r2 * 7 + c2) as u8;
            if is_valid(from) && is_valid(over) && is_valid(to) && occupied(p, from) && occupied(p, over) && !occupied(p, to) {
                out.push(Move { from, over, to });
            }
        }
    }
    out.sort_by_key(|m| (m.from, m.to));
    out
}

#[test]
fn board_has_37_holes_in_3_5_7_7_7_5_3_rows() {
    assert_eq!(VALID.count_ones(), 37);
    let rows: Vec<u32> = (0..7).map(|r| ((VALID >> (r * 7)) & 0x7f).count_ones()).collect();
    assert_eq!(rows, vec![3, 5, 7, 7, 7, 5, 3]);
}

#[test]
fn centre_start_has_four_moves() {
    let p = start(CENTRE);
    assert_eq!(p.count_ones(), 36);
    assert_eq!(moves(p).count(), 4);
}

#[test]
fn shift_generator_matches_brute_force() {
    let mut seed = 0x1234_5678_9abc_def0u64;
    for _ in 0..20_000 {
        let p = rng(&mut seed) & VALID;
        let mut fast: Vec<Move> = moves(p).collect();
        fast.sort_by_key(|m| (m.from, m.to));
        assert_eq!(fast, brute_moves(p), "position {p:#x}");
        assert_eq!(has_moves(p), !fast.is_empty());
    }
}

#[test]
fn apply_removes_one_marble_and_moves_the_jumper() {
    let p = start(CENTRE);
    for m in moves(p) {
        let q = apply(p, m);
        assert_eq!(q.count_ones(), 35);
        assert!(!occupied(q, m.from) && !occupied(q, m.over) && occupied(q, m.to));
        assert_eq!(m.over, (m.from + m.to) / 2);
    }
}

#[test]
fn labels_use_files_a_to_g_and_ranks_1_to_7() {
    assert_eq!(label(CENTRE), "d4");
    assert_eq!(label(2), "c7");
    assert_eq!(label(46), "e1");
    assert_eq!(parse_label("d4"), Some(CENTRE));
    assert_eq!(parse_label("a1"), None); // corner, not a hole
}
