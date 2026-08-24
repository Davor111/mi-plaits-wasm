//! Parameter id mapping for the FFI setter.
//!
//! Ids are grouped by destination so the JS side stays readable:
//! `0..` writes `Patch`, `16..` writes `Modulations`, `32..` writes the
//! `Modulations` "patched" flags.

use mi_plaits_dsp::voice::{Modulations, NUM_ENGINES, Patch};

// Patch
pub const ENGINE: u32 = 0;
pub const NOTE: u32 = 1;
pub const HARMONICS: u32 = 2;
pub const TIMBRE: u32 = 3;
pub const MORPH: u32 = 4;
pub const DECAY: u32 = 5;
pub const LPG_COLOUR: u32 = 6;
pub const FM_AMOUNT: u32 = 7;
pub const TIMBRE_MOD_AMOUNT: u32 = 8;
pub const MORPH_MOD_AMOUNT: u32 = 9;

// Modulations
pub const MOD_ENGINE: u32 = 16;
pub const MOD_NOTE: u32 = 17;
pub const MOD_FREQUENCY: u32 = 18;
pub const MOD_HARMONICS: u32 = 19;
pub const MOD_TIMBRE: u32 = 20;
pub const MOD_MORPH: u32 = 21;
pub const MOD_TRIGGER: u32 = 22;
pub const MOD_LEVEL: u32 = 23;

// Modulations flags
pub const FREQUENCY_PATCHED: u32 = 32;
pub const TIMBRE_PATCHED: u32 = 33;
pub const MORPH_PATCHED: u32 = 34;
pub const TRIGGER_PATCHED: u32 = 35;
pub const LEVEL_PATCHED: u32 = 36;

/// Applies one parameter. Unknown ids are ignored so the JS side can evolve
/// without breaking an older `.wasm`.
pub fn set(patch: &mut Patch, m: &mut Modulations, id: u32, value: f32) {
    match id {
        ENGINE => {
            // `as i32` saturates on out-of-range and maps NaN to 0.
            patch.engine = (value as i32).clamp(0, NUM_ENGINES as i32 - 1) as usize
        }
        NOTE => patch.note = value,
        HARMONICS => patch.harmonics = value,
        TIMBRE => patch.timbre = value,
        MORPH => patch.morph = value,
        DECAY => patch.decay = value,
        LPG_COLOUR => patch.lpg_colour = value,
        FM_AMOUNT => patch.frequency_modulation_amount = value,
        TIMBRE_MOD_AMOUNT => patch.timbre_modulation_amount = value,
        MORPH_MOD_AMOUNT => patch.morph_modulation_amount = value,

        MOD_ENGINE => m.engine = value,
        MOD_NOTE => m.note = value,
        MOD_FREQUENCY => m.frequency = value,
        MOD_HARMONICS => m.harmonics = value,
        MOD_TIMBRE => m.timbre = value,
        MOD_MORPH => m.morph = value,
        MOD_TRIGGER => m.trigger = value,
        MOD_LEVEL => m.level = value,

        FREQUENCY_PATCHED => m.frequency_patched = value != 0.0,
        TIMBRE_PATCHED => m.timbre_patched = value != 0.0,
        MORPH_PATCHED => m.morph_patched = value != 0.0,
        TRIGGER_PATCHED => m.trigger_patched = value != 0.0,
        LEVEL_PATCHED => m.level_patched = value != 0.0,

        _ => {}
    }
}
