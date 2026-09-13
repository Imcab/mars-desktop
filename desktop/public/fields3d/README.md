# Canchas y robots 3D que viajan con la app

Para que una cancha o un robot 3D aparezca en el selector del Field 3D **sin
que el usuario tenga que descargar nada**, dejá acá una carpeta con el formato
de AdvantageScope:

    public/fields3d/<Nombre>/config.json
    public/fields3d/<Nombre>/model.glb
    public/fields3d/<Nombre>/model_0.glb   (opcional: piezas de juego / componentes)

El glob de `src/utils/field3d/assetStore.ts` las recoge en el build sin tocar
código, igual que las canchas 2D de `public/fields/`.

**Pensalo dos veces antes de usarlo.** El modelo oficial de una temporada pesa
~18 MB; meterlo acá lo suma al repositorio y a cada build. Lo normal es
instalarlo desde la pestaña **Assets** del Field 3D, que lo descarga una vez y
lo guarda en `%APPDATA%/MARS/assets3d/` (o el equivalente del sistema). Esta
carpeta es para canchas propias y chicas: un campo de práctica, una maqueta.

## Formato

`config.json` es el mismo que documenta AdvantageScope. Lo mínimo para una
cancha:

```json
{
  "name": "Mi cancha",
  "coordinateSystem": "wall-blue",
  "rotations": [{ "axis": "x", "degrees": 90 }],
  "widthInches": 651.22,
  "heightInches": 317.677
}
```

`rotations` es lo que lleva el modelo del archivo al marco Z-arriba de WPILib;
un glTF exportado con la convención del formato (Y arriba) necesita el +90° en
X del ejemplo. Después de aplicarlas, el modelo tiene que quedar centrado en el
área de juego y con la alianza azul en -X.

**Un `.step` no sirve acá.** Es un formato de CAD por fronteras, sin mallas.
Convertilo a `.glb` primero (CAD Assistant, con *merge faces within the same
part* activado).
