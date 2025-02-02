# oco2-visualization
# OCO-2 Data Visualization Platform

An interactive web application for visualizing OCO-2 (Orbiting Carbon Observatory-2) satellite data, showing global CO2 measurements through various visualization modes.

## Features

### Visualization Modes
- **Point View**: Display individual CO2 measurements as color-coded points
- **Grid Cell View**: Show satellite footprints as polygon cells
- **Globe View**: 3D visualization of data on a globe
- Color coding based on XCO2 values (380-420 ppm)

### Interactive Controls
- **Base Map Options**: 
  - Satellite imagery
  - Light theme
  - Dark theme
  - Optional labels overlay
- **Date Range Filtering**: Filter data by measurement date
- **Land Cover Overlay**: Toggle terrain visualization with adjustable opacity
- **Zoom-Based Detail**: Automatic detail adjustment based on zoom level
- **Interactive Tooltips**: Show detailed information for each measurement

## Technical Stack

### Frontend
- React.js
- DeckGL for WebGL-powered visualizations
- Mapbox GL for base maps
- Custom UI components for controls

### Backend
- FastAPI (Python)
- NetCDF4 for reading satellite data
- NumPy for data processing
- Custom data sampling and filtering algorithms

## Core Files

### Backend
1. `backend/data/visualize_oco2.py`
   - Core data processing class (OCO2DataProcessor)
   - Reads and processes NC4 satellite data files
   - Implements data filtering and sampling algorithms
   - Creates point and grid cell visualizations
   - Handles viewport-based data loading
   - Quality flag filtering

2. `backend/main.py`
   - FastAPI server implementation
   - REST API endpoints for data access
   - CORS configuration
   - Error handling
   - Data request routing
   - Viewport bounds processing

### Frontend
1. `frontend/src/App.js`
   - Main React application component
   - DeckGL map implementation
   - UI controls and state management
   - Data fetching and visualization logic
   - Interactive features (tooltips, selection)
   - Viewport management
   - Layer rendering

2. `frontend/src/App.css`
   - Application styling
   - Layout components
   - UI controls design
   - Responsive design rules
   - Animation definitions
   - Map overlay styling

## Setup Instructions

### Prerequisites
- Python 3.8+
- Node.js 14+
- OCO-2 L2 data files (.nc4 format)

### Backend Setup
1. Install Python dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. Place OCO-2 .nc4 files in `backend/data/` (for mock data only)

3. Start the FastAPI server:
   ```bash
   python main.py
   ```
   Server will run at http://localhost:8000

### Frontend Setup
1. Install Node.js dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Start the development server:
   ```bash
   npm start
   ```
   Application will open at http://localhost:3000

## Data Processing

### OCO-2 Data Format
- Uses Level 2 Lite Files (.nc4)
- Key variables:
  - xco2: CO2 measurements
  - latitude/longitude: measurement locations
  - vertex_latitude/longitude: footprint vertices
  - xco2_quality_flag: data quality indicator
  - sounding_id: unique identifier with timestamp

### Data Filtering

- Quality flag filtering (0 = good quality)
- XCO2 range: 380-420 ppm
- Viewport-based filtering:
  - Only loads data points visible in current map view
  - Uses viewport bounds (minLon, minLat, maxLon, maxLat)
  - Reduces memory usage and improves performance
  - Updates dynamically as user pans/zooms
  - Example: If viewing Asia, won't load data from Americas

- Zoom-based filtering:
  - Adjusts data density based on zoom level
  - Lower zoom (farther out):
    - More aggressive sampling (e.g., 1 in 10 points)
    - Larger point sizes
    - Focuses on showing general patterns
  - Higher zoom (closer in):
    - Less or no sampling
    - Smaller point/grid cell sizes
    - Shows detailed measurements
  - Zoom levels:
    - ≤ 3: Large overview (100km points)
    - 4-5: Medium detail (75km points)
    - ≥ 6: Full detail (50km points)

## Performance Optimizations

- Dynamic data loading based on viewport:
  - Only fetches data when viewport changes (pan/zoom)
  - Uses debouncing to prevent excessive API calls
  - Sends viewport bounds to backend for data filtering
  - Reduces memory usage and network traffic
  - Example: Moving from Asia to Americas triggers new data load

- Automatic data sampling at lower zoom levels:
  - Reduces point density when zoomed out
  - Uses statistical sampling to maintain data representation
  - Improves rendering performance
  - Example: At zoom level 2, shows 10% of points

- Efficient grid cell generation:
  - Creates polygons only for visible area
  - Caches generated grid cells
  - Uses GPU-accelerated rendering
  - Optimizes vertex calculations
  - Example: 1000 measurements might become 100 grid cells

- Debounced viewport updates:
  - Waits for user to finish pan/zoom before fetching
  - Default 500ms delay between updates
  - Prevents API overload during continuous movement
  - Reduces server load and API calls
  - Example: Smooth panning triggers single update instead of many

- Frontend data caching:
  - Stores recently viewed data in memory
  - Prevents redundant API calls for same area
  - Improves response time for common interactions
  - Clears automatically when memory limit reached
  - Example: Returning to previous view uses cached data

## Efficient GCS Data Access

#### Current Issues with File Downloads:
- Downloads entire NC4 files (~300MB each)
- Creates unnecessary network traffic
- Requires temp file management
- Adds latency to visualization
- Wastes bandwidth on unused data

#### Proposed Optimizations:

1. **Preprocessed Data Storage**:
```python
# Process NC4 files into smaller chunks during upload
def preprocess_for_gcs(nc4_file):
    # Split data into geographic grid cells (e.g., 10x10 degree chunks)
    chunks = split_into_grid_cells(nc4_file)
    
    # Store each chunk with geographic indexing
    for lat, lon in chunks:
        blob_name = f"processed/{lat}_{lon}.parquet"
        # Store as efficient format (e.g., parquet)
        upload_to_gcs(chunks[lat, lon], blob_name)
```

2. **Smart Data Fetching**:
```python
def fetch_viewport_data(bounds, zoom):
    # Calculate which chunks intersect with viewport
    required_chunks = get_required_chunks(bounds)
    
    # Parallel fetch only needed chunks
    chunks = parallel_fetch_chunks(required_chunks)
    
    # Merge and filter in memory
    return process_chunks(chunks, bounds, zoom)
```

3. **Caching Layer**:
```python
# Add Redis/Memcached for frequently accessed regions
@cache.memoize(timeout=3600)
def get_cached_chunk(lat, lon):
    return fetch_from_gcs(f"processed/{lat}_{lon}.parquet")
```

4. **Streaming Processing**:
```python
# Stream data instead of downloading
def stream_process_data(gcs_path):
    with gcs.open(gcs_path) as f:
        # Process data in chunks without full download
        for chunk in pd.read_parquet(f, chunks=True):
            yield process_chunk(chunk)
```

#### Benefits:
- Reduced network traffic (only fetch needed data)
- Lower latency (smaller, targeted data transfers)
- Better scalability (parallel chunk processing)
- Efficient memory usage (stream processing)
- Improved user experience (faster loading)

#### Implementation Steps:
1. Create preprocessing pipeline for NC4 files
2. Set up geographic indexing system
3. Implement chunk-based data access
4. Add caching layer
5. Update API endpoints for chunk requests

## Future Implementations

### GCP Integration Guide

#### 1. Backend Changes

##### In `backend/data/visualize_oco2.py`:
```python
from google.cloud import storage
import xarray as xr
import fsspec
import gcsfs

class OCO2DataProcessor:
    def __init__(self, use_gcs: bool = False, bucket_name: Optional[str] = None):
        self.use_gcs = use_gcs
        if use_gcs:
            # Initialize GCS filesystem
            self.fs = gcsfs.GCSFileSystem(project='your-project')
            self.bucket = f"gs://{bucket_name}"

    def load_data(self, file_path: str, bounds: tuple) -> xr.Dataset:
        if self.use_gcs:
            # Direct streaming from GCS
            gcs_path = f"{self.bucket}/{file_path}"
            with self.fs.open(gcs_path) as f:
                # Open dataset without downloading
                ds = xr.open_dataset(f)
                # Filter data by bounds before loading into memory
                filtered_ds = ds.sel(
                    latitude=slice(bounds[1], bounds[3]),
                    longitude=slice(bounds[0], bounds[2])
                )
                return filtered_ds.load()
```

##### In `backend/main.py`:
```python
# FastAPI for REST endpoints
from fastapi import FastAPI, HTTPException, Query       
# Enable cross-origin requests
from fastapi.middleware.cors import CORSMiddleware      
# Load GCS configuration
from config import settings                            

app = FastAPI()

processor = OCO2DataProcessor(
    use_gcs=settings.USE_GCS,                         # Enable/disable GCS based on config
    bucket_name=settings.GCS_BUCKET                   # Set bucket from config
)

# Endpoint to list available files
@app.get("/files")                                    
async def list_files() -> dict:
    try:
        files = processor.get_available_files()        # Get files from GCS or local
        return {
            "status": "success",
            "files": files
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))  # Handle errors gracefully
```

##### In `frontend/src/App.js`:
```javascript
const FileSelector = ({ onFileSelect, currentFile }) => {
  // Store available files list
  const [files, setFiles] = useState([]);              
  
  useEffect(() => {
    // Fetch available files on component mount
    const fetchFiles = async () => {                   
      try {
        const response = await fetch('http://localhost:8000/files');  // Get file list from API
        const data = await response.json();
        if (data.status === 'success') {
          setFiles(data.files);                        // Update files in state
        }
      } catch (err) {
        console.error('Error fetching files:', err);   // Handle errors
      }
    };
    fetchFiles();
  }, []);

  // File selection UI component
  return (
    <div className="file-selector">                    
      <select 
        value={currentFile} 
        onChange={(e) => onFileSelect(e.target.value)} // Handle file selection
      >
        <option value="">Select a file...</option>
        {files.map(file => (                          // Render file options
          <option key={file.name} value={file.name}>
            {file.name}
          </option>
        ))}
      </select>
    </div>
  );
};

// Fetch data when file/viewport changes
const fetchData = useCallback(async () => {            
  if (!currentFile) return;                           // Only fetch if file is selected
  
  try {
    // Build query parameters
    const params = new URLSearchParams({              
      bounds: boundStr,                               // Current viewport bounds
      zoom: viewport.zoom,                            // Current zoom level
      view_mode: viewMode,                            // Point/grid cell mode
      file_path: currentFile                          // Selected file path in GCS
    });
    
    const response = await fetch(`http://localhost:8000/data?${params}`);  // Fetch data
    const result = await response.json();
    setData(result.data);                            // Update visualization data
  } catch (error) {
    console.error('Error:', error);                  // Handle errors
  }
}, [viewport, viewMode, currentFile]);
```

#### 3. Configuration Setup

##### Create `backend/config.py`:
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    USE_GCS: bool = False
    GCS_BUCKET: str = "oco2-data-bucket"
    GCS_PROJECT: str = "your-project-id"
    
    class Config:
        env_file = ".env"

settings = Settings()
```

#### 4. Deployment Steps

1. Set up GCP Project:
```bash
# Install Google Cloud SDK
gcloud init
gcloud config set project your-project-id

# Create GCS bucket
gsutil mb gs://oco2-data-bucket

# Upload data
gsutil -m cp ./backend/data/*.nc4 gs://oco2-data-bucket/nc4/
```

2. Create Service Account:
- Go to GCP Console > IAM & Admin > Service Accounts
- Create new service account with Storage Object Viewer role
- Download JSON key file
- Set GOOGLE_APPLICATION_CREDENTIALS environment variable

3. Install Dependencies:
```bash
pip install google-cloud-storage pydantic-settings python-dotenv
```

4. Environment Configuration:
     ```bash
# Create .env file
cat > .env << EOL
USE_GCS=True
GCS_BUCKET=oco2-data-bucket
GCS_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
EOL
```

This implementation will:
- Enable cloud storage for NC4 files
- Add file selection UI
- Support dynamic data loading
- Maintain existing functionality
- Enable scalable deployment

## Data
The NC4 files in `backend/data/` contain OCO-2 satellite measurements. 

### Direct GCS Data Access

Instead of downloading files, we should stream and process data directly from GCS:

```python
from google.cloud import storage
import xarray as xr
import fsspec
import gcsfs

class OCO2DataProcessor:
    def __init__(self, use_gcs: bool = False, bucket_name: Optional[str] = None):
        self.use_gcs = use_gcs
        if use_gcs:
            # Initialize GCS filesystem
            self.fs = gcsfs.GCSFileSystem(project='your-project')
            self.bucket = f"gs://{bucket_name}"

    def load_data(self, file_path: str, bounds: tuple) -> xr.Dataset:
        if self.use_gcs:
            # Direct streaming from GCS
            gcs_path = f"{self.bucket}/{file_path}"
            with self.fs.open(gcs_path) as f:
                # Open dataset without downloading
                ds = xr.open_dataset(f)
                # Filter data by bounds before loading into memory
                filtered_ds = ds.sel(
                    latitude=slice(bounds[1], bounds[3]),
                    longitude=slice(bounds[0], bounds[2])
                )
                return filtered_ds.load()
```

Benefits of this approach:
- No temporary file downloads
- Streams only required data
- Filters data before loading into memory
- Lower latency and bandwidth usage
- Better resource utilization 
