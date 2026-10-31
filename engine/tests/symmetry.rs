use engine::board::*;
use engine::class::*;
use engine::symmetry::*;

fn rng(seed: &mut u64) -> u64 {
    *seed ^= *seed >> 12;
    *seed ^= *seed << 25;
    *seed ^= *seed >> 27;
    seed.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

#[test]
fn every_transform_is_a_bijection_on_the_board() {
    for t in 0..8 {
        assert_eq!(transform(t, VALID), VALID);
        let mut seen = 0u64;
        for &c in CELLS.iter() {
            let img = transform_cell(t, c);
            assert!(is_valid(img));
            seen |= 1 << img;
            assert_eq!(transform(t, 1 << c), 1 << img);
        }
        assert_eq!(seen, VALID);
    }
}

#[test]
fn transforms_form_a_group_with_inverses() {
    let p = 0x0001_2345_6789_abcd & VALID;
    let images: Vec<u64> = (0..8).map(|t| transform(t, p)).collect();
    for a in 0..8 {
        for b in 0..8 {
            assert!(images.contains(&transform(a, transform(b, p))));
        }
        assert_eq!(transform(INVERSE[a as usize], transform(a, p)), p);
    }
}

#[test]
fn canon_is_invariant_and_minimal() {
    let mut seed = 99u64;
    for _ in 0..10_000 {
        let p = rng(&mut seed) & VALID;
        let c = canon(p);
        for t in 0..8 {
            assert_eq!(canon(transform(t, p)), c);
            assert!(c <= transform(t, p));
        }
        let (c2, t) = canon_with_t(p);
        assert_eq!(c2, c);
        assert_eq!(transform(t, p), c);
    }
}

#[test]
fn eight_distinct_starting_holes_up_to_symmetry() {
    let mut reps: Vec<u64> = CELLS.iter().map(|&h| canon(start(h))).collect();
    reps.sort();
    reps.dedup();
    assert_eq!(reps.len(), 8);
    assert_eq!(ORBIT_REPS.len(), 8);
}

#[test]
fn class_is_invariant_under_moves() {
    let mut seed = 7u64;
    for hole in CELLS {
        let mut p = start(hole);
        let k = class(p);
        loop {
            let ms: Vec<Move> = moves(p).collect();
            if ms.is_empty() {
                break;
            }
            p = apply(p, ms[(rng(&mut seed) % ms.len() as u64) as usize]);
            assert_eq!(class(p), k);
        }
    }
}

#[test]
fn centre_start_cannot_finish_with_one_marble() {
    assert_eq!(lower_bound(start(CENTRE)), 2);
    // ...but some starting hole can, at least as far as the class invariant knows.
    assert!(CELLS.iter().any(|&h| lower_bound(start(h)) == 1));
}
