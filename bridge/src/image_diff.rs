use image::{
    imageops::{resize, FilterType},
    RgbImage,
};

pub fn difference(previous: &RgbImage, next: &RgbImage) -> f64 {
    let a = resize(previous, 64, 64, FilterType::Triangle);
    let b = resize(next, 64, 64, FilterType::Triangle);
    a.as_raw()
        .iter()
        .zip(b.as_raw())
        .map(|(a, b)| (*a as f64 - *b as f64).abs())
        .sum::<f64>()
        / (64.0 * 64.0 * 3.0 * 255.0)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diff_thresholds() {
        let black = RgbImage::new(32, 32);
        let white = RgbImage::from_pixel(32, 32, image::Rgb([255, 255, 255]));
        assert_eq!(difference(&black, &black), 0.0);
        assert_eq!(difference(&black, &white), 1.0);
    }
}
