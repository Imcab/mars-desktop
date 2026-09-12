//! Traducción entre el marco de Gazebo y el de WPILib.
//!
//! Gazebo tiene el origen en el CENTRO de la cancha; WPILib lo tiene en la
//! esquina del muro de la alianza azul, con +X hacia el muro contrario y +Y a
//! la izquierda. Los dos son diestros con Z arriba y yaw positivo en sentido
//! antihorario, así que la conversión es una traslación pura: no hay rotación
//! ni espejo.
//!
//! El bridge publica en la convención de WPILib, no en la de Gazebo, y esto es
//! deliberado: así la simulación es indistinguible de un robot real desde la
//! app, que ya sabe convertir entre `wall_blue`, `center` y `center_rotated`
//! con su selector de COORDS. Publicar en coordenadas de Gazebo obligaría a
//! meter un caso especial de "modo sim" en el renderizador.

/// Dimensiones de la cancha. Tienen que coincidir con el `<plane><size>` del
/// mundo: si divergen, las poses salen desplazadas y no hay ningún error.
/// `sim/protocol/check.py` verifica que coincidan.
#[derive(Debug, Clone, Copy)]
pub struct Field {
    pub length_m: f64,
    pub width_m: f64,
}

impl Field {
    /// Traslada una posición del marco de Gazebo al de WPILib.
    pub fn to_wpilib(&self, gz_x: f64, gz_y: f64) -> (f64, f64) {
        (gz_x + self.length_m / 2.0, gz_y + self.width_m / 2.0)
    }
}

/// Yaw en radianes a partir de un quaternion, en el rango [-pi, pi].
///
/// Es la única componente que sobrevive al pasar a Pose2d. Se calcula con
/// atan2 y no despejando el ángulo de un solo término, para que funcione en las
/// cuatro cuadrantes y no se rompa cerca de +-90 grados.
pub fn yaw_from_quaternion(w: f64, x: f64, y: f64, z: f64) -> f64 {
    let siny_cosp = 2.0 * (w * z + x * y);
    let cosy_cosp = 1.0 - 2.0 * (y * y + z * z);
    siny_cosp.atan2(cosy_cosp)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cancha de 16.54 x 8.21, la misma que usan los mundos del repo.
    fn cancha() -> Field {
        Field { length_m: 16.54, width_m: 8.21 }
    }

    #[test]
    fn el_centro_de_gazebo_es_el_centro_de_la_cancha() {
        let (x, y) = cancha().to_wpilib(0.0, 0.0);
        assert!((x - 8.27).abs() < 1e-9);
        assert!((y - 4.105).abs() < 1e-9);
    }

    #[test]
    fn la_esquina_azul_es_el_origen_de_wpilib() {
        // La esquina del muro azul está en (-length/2, -width/2) en Gazebo.
        let (x, y) = cancha().to_wpilib(-8.27, -4.105);
        assert!(x.abs() < 1e-9, "x = {x}");
        assert!(y.abs() < 1e-9, "y = {y}");
    }

    #[test]
    fn el_yaw_sale_de_las_cuatro_cuadrantes() {
        // Identidad: mirando a +X.
        assert!(yaw_from_quaternion(1.0, 0.0, 0.0, 0.0).abs() < 1e-9);

        // 90 grados antihorario sobre Z: q = (cos45, 0, 0, sin45).
        let h = std::f64::consts::FRAC_1_SQRT_2;
        let yaw = yaw_from_quaternion(h, 0.0, 0.0, h);
        assert!((yaw - std::f64::consts::FRAC_PI_2).abs() < 1e-9, "yaw = {yaw}");

        // -90 grados. Un despeje ingenuo con asin daría el mismo valor que +90.
        let yaw = yaw_from_quaternion(h, 0.0, 0.0, -h);
        assert!((yaw + std::f64::consts::FRAC_PI_2).abs() < 1e-9, "yaw = {yaw}");

        // 180 grados: el caso donde cosy_cosp cambia de signo.
        let yaw = yaw_from_quaternion(0.0, 0.0, 0.0, 1.0);
        assert!((yaw.abs() - std::f64::consts::PI).abs() < 1e-9, "yaw = {yaw}");
    }
}
