// Box configs based on top 5 sizes from shipment - RS
export const BOX_CONFIGS = [
  {
    id: 'box1',
    dimensions: { width: 17.5/12, height: 5.75/12, depth: 13.0/12 },
    color: '#FF6B35',
    label: '17.5″ × 13″ × 5.75″'
  },
  {
    id: 'box2',
    dimensions: { width: 9.5/12, height: 48.0/12, depth: 4.5/12 },
    color: '#004E89',
    label: '9.5″ × 4.5″ × 48″'
  },
  {
    id: 'box3',
    dimensions: { width: 30.25/12, height: 13.5/12, depth: 25.63/12 },
    color: '#1AA37A',
    label: '30.25″ × 25.63″ × 13.5″'
  },
  {
    id: 'box4',
    dimensions: { width: 29.0/12, height: 5.5/12, depth: 26.0/12 },
    color: '#9B59B6',
    label: '29″ × 26″ × 5.5″'
  },
  {
    id: 'box5',
    dimensions: { width: 12.75/12, height: 5.75/12, depth: 7.5/12 },
    color: '#E74C3C',
    label: '12.75″ × 7.5″ × 5.75″'
  }
];

// Standard 53' trailer dimensions in feet - RS
export const TRUCK_DIMENSIONS = {
  length: 53,
  width: 8.5,
  height: 9
};

export const TRUCK_VOLUME =
  TRUCK_DIMENSIONS.length * TRUCK_DIMENSIONS.height * TRUCK_DIMENSIONS.width;
