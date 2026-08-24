//! One Plaits voice plus its parameter state and render buffers.

use mi_plaits_dsp::voice::{Modulations, Patch, Voice};

use crate::params;

pub struct Synth {
    voice: Voice<'static>,
    patch: Patch,
    modulations: Modulations,
    out: Box<[f32]>,
    aux: Box<[f32]>,
}

impl Synth {
    /// `block_size` must equal the number of frames passed to each `render`.
    pub fn new(block_size: usize, sample_rate: f32) -> Self {
        let mut voice = Voice::new(block_size, sample_rate);
        voice.init();

        Self {
            voice,
            patch: Patch::default(),
            modulations: Modulations::default(),
            out: vec![0.0; block_size].into_boxed_slice(),
            aux: vec![0.0; block_size].into_boxed_slice(),
        }
    }

    pub fn set_param(&mut self, id: u32, value: f32) {
        params::set(&mut self.patch, &mut self.modulations, id, value);
    }

    /// Renders one block. Allocation-free; safe to call on the audio thread.
    pub fn render(&mut self) {
        self.voice
            .render(&self.patch, &self.modulations, &mut self.out, &mut self.aux);
    }

    pub fn out(&self) -> &[f32] {
        &self.out
    }

    pub fn aux(&self) -> &[f32] {
        &self.aux
    }

    pub fn out_ptr(&mut self) -> *mut f32 {
        self.out.as_mut_ptr()
    }

    pub fn aux_ptr(&mut self) -> *mut f32 {
        self.aux.as_mut_ptr()
    }
}
