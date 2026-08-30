// Steelcase load examples mapped into runtime-friendly box templates.
// Replace this file with direct dataset parsing when a canonical source file is available.
export const STEELCASE_LOAD_EXAMPLES = [
  {
    id: 'steelcase-office-mix-a',
    name: 'Steelcase Office Mix A',
    description: 'Balanced mix of small cartons and long parcels for training.',
    boxes: [
      {
        typeId: 'sc-a-small-175x13x575',
        label: 'Steelcase Carton 17.5" x 13" x 5.75"',
        dimensionsInches: { width: 17.5, depth: 13.0, height: 5.75 },
        color: '#FF6B35',
        quantity: 14
      },
      {
        typeId: 'sc-a-long-95x45x48',
        label: 'Steelcase Parcel 9.5" x 4.5" x 48"',
        dimensionsInches: { width: 9.5, depth: 4.5, height: 48.0 },
        color: '#004E89',
        quantity: 9
      },
      {
        typeId: 'sc-a-flat-29x26x55',
        label: 'Steelcase Flat 29" x 26" x 5.5"',
        dimensionsInches: { width: 29.0, depth: 26.0, height: 5.5 },
        color: '#9B59B6',
        quantity: 7,
        fragile: true   // matches box4 in constants.js (flat panel / glass-type)
      }
    ]
  },
  {
    id: 'steelcase-furniture-mix-b',
    name: 'Steelcase Furniture Mix B',
    description: 'Higher share of medium furniture boxes with mixed heights.',
    boxes: [
      {
        typeId: 'sc-b-medium-3025x2563x135',
        label: 'Steelcase Furniture 30.25" x 25.63" x 13.5"',
        dimensionsInches: { width: 30.25, depth: 25.63, height: 13.5 },
        color: '#1AA37A',
        quantity: 10
      },
      {
        typeId: 'sc-b-flat-29x26x55',
        label: 'Steelcase Flat 29" x 26" x 5.5"',
        dimensionsInches: { width: 29.0, depth: 26.0, height: 5.5 },
        color: '#9B59B6',
        quantity: 8,
        fragile: true   // matches box4 in constants.js (flat panel / glass-type)
      },
      {
        typeId: 'sc-b-small-1275x75x575',
        label: 'Steelcase Accessory 12.75" x 7.5" x 5.75"',
        dimensionsInches: { width: 12.75, depth: 7.5, height: 5.75 },
        color: '#E74C3C',
        quantity: 15,
        fragile: true   // matches box5 in constants.js (small accessory)
      }
    ]
  },
  {
    id: 'steelcase-high-density-c',
    name: 'Steelcase High Density C',
    description: 'Stress-style blend with repeated SKUs to emulate dense loading.',
    boxes: [
      {
        typeId: 'sc-c-small-175x13x575',
        label: 'Steelcase Carton 17.5" x 13" x 5.75"',
        dimensionsInches: { width: 17.5, depth: 13.0, height: 5.75 },
        color: '#FF6B35',
        quantity: 20
      },
      {
        typeId: 'sc-c-medium-3025x2563x135',
        label: 'Steelcase Furniture 30.25" x 25.63" x 13.5"',
        dimensionsInches: { width: 30.25, depth: 25.63, height: 13.5 },
        color: '#1AA37A',
        quantity: 14
      },
      {
        typeId: 'sc-c-long-95x45x48',
        label: 'Steelcase Parcel 9.5" x 4.5" x 48"',
        dimensionsInches: { width: 9.5, depth: 4.5, height: 48.0 },
        color: '#004E89',
        quantity: 11
      }
    ]
  }
];
