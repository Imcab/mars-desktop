// Cancha "evergreen": la alfombra, las paredes y las zonas de alianza dibujadas
// a mano, sin ningún modelo.
//
// Existe para que la pestaña sirva DESDE QUE SE ABRE. El modelo oficial de una
// temporada pesa ~20 MB y hay que descargarlo; hasta entonces —y en una
// notebook en el pit, sin internet— una cancha esquemática a escala real ya
// permite ver la odometría, comparar el setpoint con la pose medida y revisar
// una trayectoria, que es el 90 % del uso.
//
// Todo se arma en el marco del modelo: origen en el centro del área de juego,
// +X hacia el rojo, +Y hacia la izquierda vista desde el azul, +Z arriba.

import {
  BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshPhongMaterial, PlaneGeometry,
} from "three"
import { FieldSize } from "./frames"

/** Medidas de la cancha FRC moderna, por si no hay ninguna declarada. */
export const DEFAULT_FIELD_SIZE: FieldSize = { length: 16.541, width: 8.069 }

const CARPET_COLOR = 0x6e727c
const WALL_COLOR = 0xd8d9de
const BLUE = 0x2f6fdb
const RED = 0xd63b3b

/** Alto de la pared perimetral. La real ronda medio metro. */
const WALL_HEIGHT = 0.5
const WALL_THICKNESS = 0.05

/**
 * Franja de alianza a cada extremo, en metros de largo de cancha.
 *
 * No pretende ser ninguna zona reglamentaria concreta — cambia cada
 * temporada — sino dejar clarísimo de un vistazo qué extremo es cuál, que es
 * para lo único que se mira una cancha esquemática.
 */
const ALLIANCE_BAND = 1.2

function carpet(size: FieldSize): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(size.length, size.width),
    new MeshPhongMaterial({ color: CARPET_COLOR, shininess: 0 }),
  )
  mesh.receiveShadow = true
  return mesh
}

function allianceBand(size: FieldSize, color: number, sign: number): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(ALLIANCE_BAND, size.width),
    new MeshPhongMaterial({
      color, shininess: 0,
      // Transparente y no opaco: la franja tiñe la alfombra en vez de taparla,
      // así se sigue leyendo como piso y no como una plataforma elevada.
      transparent: true, opacity: 0.45,
    }),
  )
  // Un pelo por encima de la alfombra: a la misma altura las dos caras pelean
  // por el z-buffer y aparece el moteado clásico del z-fighting.
  mesh.position.set(sign * (size.length / 2 - ALLIANCE_BAND / 2), 0, 0.002)
  mesh.receiveShadow = true
  return mesh
}

function wall(length: number, width: number, color: number): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(length, width, WALL_HEIGHT),
    new MeshPhongMaterial({ color, shininess: 6 }),
  )
  mesh.position.z = WALL_HEIGHT / 2
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Grilla de un metro sobre la alfombra, para leer distancias de un vistazo. */
export function makeFieldGrid(size: FieldSize, cell: number): LineSegments {
  const points: number[] = []
  const halfLength = size.length / 2
  const halfWidth = size.width / 2

  for (let x = -halfLength; x <= halfLength + 1e-6; x += cell) {
    points.push(x, -halfWidth, 0, x, halfWidth, 0)
  }
  for (let y = -halfWidth; y <= halfWidth + 1e-6; y += cell) {
    points.push(-halfLength, y, 0, halfLength, y, 0)
  }
  // Los bordes exactos, que la división por `cell` casi nunca alcanza.
  points.push(halfLength, -halfWidth, 0, halfLength, halfWidth, 0)
  points.push(-halfLength, halfWidth, 0, halfLength, halfWidth, 0)

  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3))

  const grid = new LineSegments(geometry, new LineBasicMaterial({
    color: 0x8d8f99, transparent: true, opacity: 0.28, depthWrite: false,
  }))
  // Sobre la alfombra y sobre las franjas de alianza.
  grid.position.z = 0.004
  grid.renderOrder = 1
  return grid
}

/**
 * Media línea de cancha, en blanco. Es la referencia que todo el mundo usa
 * para saber de un vistazo en qué mitad está el robot.
 */
function centerLine(size: FieldSize): LineSegments {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(
    [0, -size.width / 2, 0, 0, size.width / 2, 0], 3,
  ))
  const line = new LineSegments(geometry, new LineBasicMaterial({ color: 0xf2f2f5 }))
  line.position.z = 0.005
  line.renderOrder = 2
  return line
}

/** Cancha esquemática completa, lista para colgar de la escena. */
export function makeEvergreenField(size: FieldSize): Group {
  const group = new Group()
  group.name = "evergreen-field"

  group.add(carpet(size))
  group.add(allianceBand(size, BLUE, -1))
  group.add(allianceBand(size, RED, 1))
  group.add(centerLine(size))

  const halfLength = size.length / 2 + WALL_THICKNESS / 2
  const halfWidth = size.width / 2 + WALL_THICKNESS / 2

  // Las paredes de los extremos van del color de su alianza: es la señal más
  // barata de en qué extremo está el robot cuando la cámara mira de lado.
  const blueWall = wall(WALL_THICKNESS, size.width + WALL_THICKNESS * 2, BLUE)
  blueWall.position.x = -halfLength
  const redWall = wall(WALL_THICKNESS, size.width + WALL_THICKNESS * 2, RED)
  redWall.position.x = halfLength
  group.add(blueWall, redWall)

  const near = wall(size.length, WALL_THICKNESS, WALL_COLOR)
  near.position.y = -halfWidth
  const far = wall(size.length, WALL_THICKNESS, WALL_COLOR)
  far.position.y = halfWidth
  group.add(near, far)

  return group
}

/**
 * Posiciones de las seis driver stations de una cancha esquemática.
 *
 * Un asset con modelo las trae en su config; la esquemática no, así que se
 * reparten a tercios sobre cada pared de extremo, que es como están en la
 * cancha real. El orden coincide con el del config de AdvantageScope: primero
 * las tres azules, después las tres rojas.
 */
export function evergreenDriverStations(size: FieldSize): [number, number][] {
  const x = size.length / 2
  const offsets = [size.width / 3, 0, -size.width / 3]
  return [
    ...offsets.map((y): [number, number] => [-x, y]),
    ...offsets.map((y): [number, number] => [x, -y]),
  ]
}

/** Color de alianza, compartido con los objetos que se pintan por alianza. */
export const ALLIANCE_COLORS: Record<"blue" | "red", Color> = {
  blue: new Color(BLUE),
  red: new Color(RED),
}
