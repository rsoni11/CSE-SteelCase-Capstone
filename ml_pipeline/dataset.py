import pandas as pd
import torch
import numpy as np
from torch.utils.data import Dataset, DataLoader
from pathlib import Path

class TruckPackingDataset(Dataset):
    def __init__(self, csv_file, max_boxes=60):
        self.df = pd.read_csv(csv_file)
        self.max_boxes = max_boxes
        self.samples = []
        
        # Group by plan_id to process each truckload in isolation
        for plan_id, group in self.df.groupby('plan_id'):
            group = group.sort_values('load_seq')
            
            placed_boxes = []
            for _, row in group.iterrows():
                # 1. Input Features: Properties of the incoming box
                current_box = [
                    row['length_in'], 
                    row['width_in'], 
                    row['height_in'],
                    row['weight_lb'], 
                    float(row['fragile'])
                ]
                
                # 2. Target Output: The exact X, Y, Z coordinates and dimensions
                target = [
                    row['pos_x_ft'], row['pos_y_ft'], row['pos_z_ft'],
                    row['size_x_ft'], row['size_y_ft'], row['size_z_ft']
                ]
                
                # 3. Create the training sample
                self.samples.append({
                    'context': list(placed_boxes), 
                    'current_box': current_box,
                    'target': target
                })
                
                # 4. Add current target to the truck context for the next box
                placed_boxes.append(target)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        
        # Zero-pad context so all batches have the identical (60, 6) shape
        context = np.zeros((self.max_boxes, 6), dtype=np.float32)
        num_placed = len(sample['context'])
        
        if num_placed > 0:
            context[:num_placed, :] = sample['context']
            
        return {
            'context': torch.tensor(context),
            'current_box': torch.tensor(sample['current_box'], dtype=torch.float32),
            'target': torch.tensor(sample['target'], dtype=torch.float32),
            'num_placed': torch.tensor(num_placed, dtype=torch.long)
        }

# Quick test execution block
if __name__ == "__main__":
    csv_path = Path("../sandbox/out/dataset/train.csv")
    dataset = TruckPackingDataset(csv_path)
    loader = DataLoader(dataset, batch_size=32, shuffle=True)
    
    print(f"Total training samples generated: {len(dataset)}")
    
    # Grab one batch to verify tensor shapes
    batch = next(iter(loader))
    print("--- Batch Test Successful ---")
    print(f"Context shape: {batch['context'].shape}")         # Expected: [32, 60, 6]
    print(f"Current box shape: {batch['current_box'].shape}") # Expected: [32, 5]
    print(f"Target shape: {batch['target'].shape}")           # Expected: [32, 6]