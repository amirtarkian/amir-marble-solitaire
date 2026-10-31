use engine::board::*;
use engine::class::lower_bound;
use engine::opening::*;
use engine::symmetry::canon;

#[test]
fn compact_keeps_order_and_all_37_bits() {
    assert_eq!(compact(VALID), (1u64 << 37) - 1);
    let a = canon(start(CENTRE));
    let b = canon(start(3));
    assert_eq!(a < b, compact(a) < compact(b));
}

#[test]
fn expand_inverts_compact() {
    for &h in CELLS.iter() {
        let p = start(h);
        assert_eq!(expand(compact(p)), p);
    }
}

#[test]
fn round_trip_keeps_every_value_including_escapes() {
    let mut seed = 3u64;
    let mut entries = Vec::new();
    for i in 0..5000 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let p = canon((seed >> 11) & VALID);
        let v = lower_bound(p) + 1 + (i % 5) as u8; // codes 0..2 and escapes
        entries.push((p, v.min(15)));
    }
    let t = OpeningTable::new(0, entries.clone());
    let back = OpeningTable::decode(&t.encode()).unwrap();
    assert_eq!(back.len(), t.len());
    for (p, v) in entries {
        assert_eq!(back.lookup(p, p), Some(v), "{p:#x}");
    }
}

#[test]
fn encode_decode_round_trip_and_lookup() {
    let entries: Vec<(Pos, u8)> = CELLS.iter().map(|&h| (canon(start(h)), 3)).collect();
    let table = OpeningTable::new(36, entries);
    let back = OpeningTable::decode(&table.encode()).unwrap();
    assert_eq!(back.len(), 8);
    assert_eq!(back.min_marbles(), 36);
    let p = start(CENTRE);
    assert_eq!(back.lookup(p, canon(p)), Some(3));
    // Below the covered range the table has no opinion.
    let q = p & !(1 << 0x10);
    assert_eq!(back.lookup(q, canon(q)), None);
    // Covered but absent means "equals the lower bound".
    let r = VALID & !(1 << 23) & !(1 << 24);
    let t2 = OpeningTable::new(35, std::iter::empty());
    assert_eq!(t2.lookup(r, canon(r)), Some(lower_bound(r)));
}

#[test]
fn decode_rejects_garbage() {
    assert!(OpeningTable::decode(b"nope").is_err());
    assert!(OpeningTable::decode(b"MSOP\x02\x20\x05\x00\x00\x00\x03").is_err());
}
