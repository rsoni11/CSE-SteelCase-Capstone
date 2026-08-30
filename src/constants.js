// Box configs — Steelcase top-5 SKUs
// US5 (Rhea): fragile flag added; US6 (Yash): STRESS_TEST_TARGET added
export const BOX_CONFIGS = [
  {
    id: 'box1',
    dimensions: { width: 17.5 / 12, height: 5.75 / 12, depth: 13.0 / 12 },
    color: '#FF6B35',
    label: '17.5″ × 13″ × 5.75″',
    physics: { mass: 20, friction: 0.9, restitution: 0.0 },
    fragile: false
  },
  {
    id: 'box2',
    dimensions: { width: 9.5 / 12, height: 48.0 / 12, depth: 4.5 / 12 },
    color: '#004E89',
    label: '9.5″ × 4.5″ × 48″',
    physics: { mass: 26, friction: 0.95, restitution: 0.0 },
    fragile: false
  },
  {
    id: 'box3',
    dimensions: { width: 30.25 / 12, height: 13.5 / 12, depth: 25.63 / 12 },
    color: '#1AA37A',
    label: '30.25″ × 25.63″ × 13.5″',
    physics: { mass: 44, friction: 0.95, restitution: 0.0 },
    fragile: false
  },
  {
    id: 'box4',
    dimensions: { width: 29.0 / 12, height: 5.5 / 12, depth: 26.0 / 12 },
    color: '#9B59B6',
    label: '29″ × 26″ × 5.5″',
    physics: { mass: 30, friction: 0.95, restitution: 0.0 },
    fragile: true   // US5: flat panel / glass-type
  },
  {
    id: 'box5',
    dimensions: { width: 12.75 / 12, height: 5.75 / 12, depth: 7.5 / 12 },
    color: '#E74C3C',
    label: '12.75″ × 7.5″ × 5.75″',
    physics: { mass: 14, friction: 0.9, restitution: 0.0 },
    fragile: true   // US5: small accessory
  }
];

// US5: boxes at or above this mass are "heavy" for fragile-stacking warnings
export const HEAVY_BOX_MASS_THRESHOLD = 25;

/**
 * Top surface of the trailer deck, in feet.
 *
 * The floor in TruckScene is a 0.2 ft slab centred at y = 0.1, so its top face
 * — the surface cargo actually rests on — is at y = 0.2. Several modules used
 * to hard-code 0.1 here, which let cargo sit 0.1 ft inside the deck and made
 * floor-contact checks miss boxes that the physics engine had settled at 0.2.
 */
export const DECK_SURFACE_Y = 0.2;

// Standard 53' trailer dimensions in feet
export const TRUCK_DIMENSIONS = {
  length: 53,
  width: 8.5,
  height: 9
};

export const TRUCK_VOLUME =
  TRUCK_DIMENSIONS.length * TRUCK_DIMENSIONS.height * TRUCK_DIMENSIONS.width;

export const MAX_BOXES = 75;
export const STRESS_TEST_TARGET = 55; // US6
