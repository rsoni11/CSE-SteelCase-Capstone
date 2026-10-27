import torch
import torch.nn as nn

class TruckPackingModel(nn.Module):
    def __init__(self):
        super(TruckPackingModel, self).__init__()
        
        # 1. Context Encoder (Processes the sequence of previously placed boxes)
        # Using an LSTM to handle the variable-length history of placed boxes
        self.lstm = nn.LSTM(
            input_size=6, 
            hidden_size=64, 
            num_layers=2, 
            batch_first=True, 
            dropout=0.1
        )
        
        # 2. Box Encoder (Processes the incoming box features)
        self.box_fc = nn.Sequential(
            nn.Linear(5, 32),
            nn.ReLU(),
            nn.Linear(32, 32),
            nn.ReLU()
        )
        
        # 3. Fusion Head (Combines context history with the incoming box to predict coordinates)
        self.fusion_fc = nn.Sequential(
            nn.Linear(64 + 32, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 6)  # Predicts: [pos_x, pos_y, pos_z, size_x, size_y, size_z]
        )

    def forward(self, context, current_box):
        # Pass context through LSTM, take the output from the final time step
        lstm_out, (hn, cn) = self.lstm(context)
        context_features = hn[-1]  # Shape: [batch_size, 64]
        
        # Pass current box through feature extractor
        box_features = self.box_fc(current_box)  # Shape: [batch_size, 32]
        
        # Concatenate both feature sets together
        combined = torch.cat((context_features, box_features), dim=1)  # Shape: [batch_size, 96]
        
        # Predict the target coordinates and dimensions
        output = self.fusion_fc(combined)
        return output

# Quick test execution block
if __name__ == "__main__":
    from dataset import TruckPackingDataset
    from torch.utils.data import DataLoader
    from pathlib import Path
    
    dataset = TruckPackingDataset(Path("../sandbox/out/dataset/train.csv"))
    loader = DataLoader(dataset, batch_size=32, shuffle=True)
    batch = next(iter(loader))
    
    model = TruckPackingModel()
    predictions = model(batch['context'], batch['current_box'])
    
    print("--- Model Forward Pass Successful ---")
    print(f"Prediction output shape: {predictions.shape}")  # Expected: [32, 6]