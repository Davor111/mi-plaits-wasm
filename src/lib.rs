//! Browser/wasm wrapper around `mi-plaits-dsp`.
//!
//! The exported C ABI is deliberately tiny: an opaque handle, an id-based
//! parameter setter, and a render call. JS reads the rendered audio straight
//! out of linear memory via the pointers returned here.

pub mod params;
mod synth;

pub use synth::Synth;

/// Creates a synth. `block_size` must match the frame count JS renders per call.
#[unsafe(no_mangle)]
pub extern "C" fn plaits_new(block_size: usize, sample_rate: f32) -> *mut Synth {
    Box::into_raw(Box::new(Synth::new(block_size, sample_rate)))
}

/// # Safety
/// `ptr` must come from `plaits_new` and must not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_free(ptr: *mut Synth) {
    if !ptr.is_null() {
        drop(unsafe { Box::from_raw(ptr) });
    }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_out_ptr(ptr: *mut Synth) -> *mut f32 {
    unsafe { (*ptr).out_ptr() }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_aux_ptr(ptr: *mut Synth) -> *mut f32 {
    unsafe { (*ptr).aux_ptr() }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_set_param(ptr: *mut Synth, id: u32, value: f32) {
    unsafe { (*ptr).set_param(id, value) }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_render(ptr: *mut Synth) {
    unsafe { (*ptr).render() }
}
