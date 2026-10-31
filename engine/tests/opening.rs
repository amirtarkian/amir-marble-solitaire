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
    assert!(OpeningTable::decode(b"MSOP\x01\x20\x05\x00\x00\x00").is_err());
}
