//! Precomputed exact values for the early game, where live proofs are too slow.
//!
//! Only positions whose value differs from the class lower bound are stored. A position
//! in the covered range that is absent therefore has value == `lower_bound`. That
//! shortcut is only sound for positions reachable from a single-vacancy start, which is
//! every position the app ever asks about.
//!
//! File format (little endian): `MSOP`, u8 version (1), u8 min_marbles, u32 count,
//! `count` varint deltas of ascending 37-bit compact keys, then `ceil(count/2)` bytes of
//! 4-bit values (even index in the low nibble).

use crate::board::Pos;
use crate::class::lower_bound;

const MAGIC: &[u8; 4] = b"MSOP";
const VERSION: u8 = 1;

/// Row r keeps columns START[r] .. START[r] + WIDTH[r].
const START: [u32; 7] = [2, 1, 0, 0, 0, 1, 2];
const WIDTH: [u32; 7] = [3, 5, 7, 7, 7, 5, 3];

/// Packs the 37 hole bits of a position into the low 37 bits, preserving order.
#[inline]
pub fn compact(p: Pos) -> u64 {
    let mut out = 0u64;
    let mut shift = 0;
    for r in 0..7 {
        let row = (p >> (7 * r)) & 127;
        out |= ((row >> START[r]) & ((1 << WIDTH[r]) - 1)) << shift;
        shift += WIDTH[r];
    }
    out
}

pub struct OpeningTable {
    min_marbles: u8,
    keys: Vec<u64>,
    vals: Vec<u8>,
}

impl OpeningTable {
    /// `entries` are (canonical position, exact value) pairs; positions with at least
    /// `min_marbles` marbles are covered by the table.
    pub fn new(min_marbles: u8, entries: impl IntoIterator<Item = (Pos, u8)>) -> Self {
        let mut pairs: Vec<(u64, u8)> = entries.into_iter().map(|(p, v)| (compact(p), v)).collect();
        pairs.sort_unstable();
        pairs.dedup_by_key(|e| e.0);
        assert!(pairs.iter().all(|e| e.1 <= 15), "values must fit in 4 bits");
        OpeningTable { min_marbles, keys: pairs.iter().map(|e| e.0).collect(), vals: pairs.iter().map(|e| e.1).collect() }
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn min_marbles(&self) -> u8 {
        self.min_marbles
    }

    /// Exact value of a reachable position, if the table covers its marble count.
    #[inline]
    pub fn lookup(&self, p: Pos, canon: Pos) -> Option<u8> {
        if (p.count_ones() as u8) < self.min_marbles {
            return None;
        }
        Some(match self.keys.binary_search(&compact(canon)) {
            Ok(i) => self.vals[i],
            Err(_) => lower_bound(p),
        })
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(10 + self.keys.len() * 4);
        out.extend_from_slice(MAGIC);
        out.push(VERSION);
        out.push(self.min_marbles);
        out.extend_from_slice(&(self.keys.len() as u32).to_le_bytes());
        let mut prev = 0u64;
        for &k in &self.keys {
            let mut d = k - prev;
            prev = k;
            loop {
                let b = (d & 0x7f) as u8;
                d >>= 7;
                if d == 0 {
                    out.push(b);
                    break;
                }
                out.push(b | 0x80);
            }
        }
        for pair in self.vals.chunks(2) {
            out.push(pair[0] | pair.get(1).map_or(0, |v| v << 4));
        }
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() < 10 || &bytes[..4] != MAGIC {
            return Err("not an opening table");
        }
        if bytes[4] != VERSION {
            return Err("unsupported opening table version");
        }
        let min_marbles = bytes[5];
        let count = u32::from_le_bytes(bytes[6..10].try_into().unwrap()) as usize;
        let mut keys = Vec::with_capacity(count);
        let mut i = 10;
        let mut prev = 0u64;
        for _ in 0..count {
            let (mut d, mut shift) = (0u64, 0);
            loop {
                let b = *bytes.get(i).ok_or("truncated keys")?;
                i += 1;
                d |= ((b & 0x7f) as u64) << shift;
                shift += 7;
                if b & 0x80 == 0 {
                    break;
                }
            }
            prev += d;
            keys.push(prev);
        }
        let packed = bytes.get(i..i + count.div_ceil(2)).ok_or("truncated values")?;
        let vals = (0..count).map(|j| (packed[j / 2] >> (4 * (j % 2))) & 15).collect();
        Ok(OpeningTable { min_marbles, keys, vals })
    }
}
