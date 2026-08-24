//! Exercises the exported C ABI the way JS does.

use mi_plaits_wasm::{params, plaits_aux_ptr, plaits_free, plaits_new, plaits_out_ptr,
                     plaits_render, plaits_set_param};

const BLOCK: usize = 128;

#[test]
fn handle_lifecycle_renders_then_frees() {
    let synth = plaits_new(BLOCK, 48000.0);
    assert!(!synth.is_null());

    unsafe {
        plaits_set_param(synth, params::TRIGGER_PATCHED, 1.0);
        plaits_set_param(synth, params::LEVEL_PATCHED, 1.0);
        plaits_set_param(synth, params::MOD_LEVEL, 1.0);
        plaits_set_param(synth, params::MOD_TRIGGER, 1.0);

        let out = plaits_out_ptr(synth);
        let aux = plaits_aux_ptr(synth);
        assert!(!out.is_null() && !aux.is_null());

        let mut peak = 0.0f32;
        for _ in 0..200 {
            plaits_render(synth);
            let block = std::slice::from_raw_parts(out, BLOCK);
            for &v in block {
                assert!(v.is_finite());
                peak = peak.max(v.abs());
            }
        }
        assert!(peak > 1e-5, "FFI render produced silence");

        plaits_free(synth);
    }
}

#[test]
fn free_tolerates_null() {
    unsafe { plaits_free(std::ptr::null_mut()) };
}
