//! Precomputed exact values for the early game, where live proofs are too slow.
//!
//! Only positions whose value differs from the class lower bound are stored. A position
//! in the covered range that is absent therefore has value == `lower_bound`. That
//! shortcut is only sound for positions reachable from a single-vacancy start, which is
//! every position the app ever asks about.
//!
//! File format (little endian): `MSOP`, u8 version (2), u8 min_marbles, u32 count,
//! u8 L, then three bit streams, each padded to whole bytes:
//! - the low `L` bits of every ascending 37-bit compact key, `L` bits each;
//! - the high bits as unary gaps (Elias–Fano): for each key, `high - previous high`
//!   zeros, then a one;
//! - per key, 2 bits holding `value - lower_bound - 1` (0..=2), or 3 for "see escapes",
//!   followed by u32 escape count and (u32 index, u8 value) pairs.

use crate::board::Pos;
use crate::class::lower_bound;

const MAGIC: &[u8; 4] = b"MSOP";
const VERSION: u8 = 2;

/// Row r keeps columns START[r] .. START[r] + WIDTH[r].
const START: [u32; 7] = [2, 1, 0, 0, 0, 1, 2];
const WIDTH: [u32; 7] = [3, 5, 7, 7, 7, 5, 3];

/// Inverse of `compact`.
pub fn expand(c: u64) -> Pos {
    let mut out = 0u64;
    let mut shift = 0;
    for r in 0..7 {
        out |= ((c >> shift) & ((1 << WIDTH[r]) - 1)) << (START[r] + 7 * r as u32);
        shift += WIDTH[r];
    }
    out
}

struct BitWriter {
    bytes: Vec<u8>,
    bit: usize,
}

impl BitWriter {
    fn new() -> Self {
        BitWriter { bytes: Vec::new(), bit: 0 }
    }

    fn push(&mut self, value: u64, width: u32) {
        for i in 0..width {
            if self.bit % 8 == 0 {
                self.bytes.push(0);
            }
            if value >> i & 1 == 1 {
                *self.bytes.last_mut().unwrap() |= 1 << (self.bit % 8);
            }
            self.bit += 1;
        }
    }
}

struct BitReader<'a> {
    bytes: &'a [u8],
    bit: usize,
}

impl BitReader<'_> {
    fn read(&mut self, width: u32) -> Result<u64, &'static str> {
        let mut v = 0u64;
        for i in 0..width {
            let byte = *self.bytes.get(self.bit / 8).ok_or("truncated bit stream")?;
            v |= ((byte >> (self.bit % 8) & 1) as u64) << i;
            self.bit += 1;
        }
        Ok(v)
    }
}

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
        let n = self.keys.len() as u64;
        let max = self.keys.last().copied().unwrap_or(0);
        let low_bits = if n == 0 { 0 } else { 64 - ((max / n).max(1)).leading_zeros() - 1 };
        let mut low = BitWriter::new();
        let mut high = BitWriter::new();
        let mut vals = BitWriter::new();
        let mut escapes = Vec::new();
        let mut prev_high = 0u64;
        for (i, (&k, &v)) in self.keys.iter().zip(&self.vals).enumerate() {
            low.push(k & ((1 << low_bits) - 1), low_bits);
            let h = k >> low_bits;
            for _ in prev_high..h {
                high.push(0, 1);
            }
            high.push(1, 1);
            prev_high = h;
            let code = v.checked_sub(lower_bound(expand(k)) + 1).filter(|&c| c < 3);
            vals.push(code.unwrap_or(3) as u64, 2);
            if code.is_none() {
                escapes.push((i as u32, v));
            }
        }
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.push(VERSION);
        out.push(self.min_marbles);
        out.extend_from_slice(&(n as u32).to_le_bytes());
        out.push(low_bits as u8);
        for stream in [low, high, vals] {
            out.extend_from_slice(&(stream.bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(&stream.bytes);
        }
        out.extend_from_slice(&(escapes.len() as u32).to_le_bytes());
        for (i, v) in escapes {
            out.extend_from_slice(&i.to_le_bytes());
            out.push(v);
        }
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() < 11 || &bytes[..4] != MAGIC {
            return Err("not an opening table");
        }
        if bytes[4] != VERSION {
            return Err("unsupported opening table version");
        }
        let min_marbles = bytes[5];
        let count = u32::from_le_bytes(bytes[6..10].try_into().unwrap()) as usize;
        let low_bits = bytes[10] as u32;
        let mut at = 11;
        let mut stream = || -> Result<&[u8], &'static str> {
            let len = u32::from_le_bytes(bytes.get(at..at + 4).ok_or("truncated")?.try_into().unwrap()) as usize;
            let s = bytes.get(at + 4..at + 4 + len).ok_or("truncated stream")?;
            at += 4 + len;
            Ok(s)
        };
        let (low_s, high_s, val_s) = (stream()?, stream()?, stream()?);
        let (mut low, mut high, mut vals) =
            (BitReader { bytes: low_s, bit: 0 }, BitReader { bytes: high_s, bit: 0 }, BitReader { bytes: val_s, bit: 0 });
        let mut keys = Vec::with_capacity(count);
        let mut values = Vec::with_capacity(count);
        let mut h = 0u64;
        for _ in 0..count {
            while high.read(1)? == 0 {
                h += 1;
            }
            let k = h << low_bits | low.read(low_bits)?;
            let code = vals.read(2)? as u8;
            keys.push(k);
            values.push(if code == 3 { 0 } else { lower_bound(expand(k)) + 1 + code });
        }
        let n_esc = u32::from_le_bytes(bytes.get(at..at + 4).ok_or("truncated escapes")?.try_into().unwrap()) as usize;
        for e in 0..n_esc {
            let rec = bytes.get(at + 4 + e * 5..at + 9 + e * 5).ok_or("truncated escapes")?;
            let i = u32::from_le_bytes(rec[..4].try_into().unwrap()) as usize;
            *values.get_mut(i).ok_or("bad escape index")? = rec[4];
        }
        Ok(OpeningTable { min_marbles, keys, vals: values })
    }
}
