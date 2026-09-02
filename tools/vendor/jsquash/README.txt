jSquash encoder-only vendor (Apache-2.0)
Source: https://github.com/jamsinclair/jSquash  (codecs from GoogleChromeLabs/squoosh)

Packages:
  @jsquash/jpeg 1.6.0   mozjpeg encoder
  @jsquash/webp 1.5.0   webp encoder (non-SIMD)
  @jsquash/avif 2.1.1   avif encoder (single-thread)
  @jsquash/oxipng 2.3.0 png optimiser (single-thread)

Patched encode entrypoints to drop wasm-feature-detect / SIMD / pthread
so they load as bare ESM on GitHub Pages.
