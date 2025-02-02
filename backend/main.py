from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import logging
import os
from data.visualize_oco2 import OCO2DataProcessor

app = FastAPI()
logger = logging.getLogger(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the absolute path to the data directory
current_dir = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(current_dir, 'data')
logger.info(f"Looking for data in: {data_dir}")

data_processor = OCO2DataProcessor(data_dir)

@app.get("/data")
async def get_data(
    bounds: str, 
    zoom: float, 
    view_mode: str = 'point',
    start_date: str = None,
    end_date: str = None
):
    try:
        minlon, minlat, maxlon, maxlat = map(float, bounds.split(','))
        logger.info(f"Request - bounds: {bounds}, zoom: {zoom}, mode: {view_mode}, dates: {start_date} to {end_date}")
        
        data = data_processor.get_data_for_viewport(
            (minlon, minlat, maxlon, maxlat),
            zoom,
            view_mode,
            start_date,
            end_date
        )
        
        # Add debug logging
        if view_mode == 'polygon':
            logger.info(f"Returning {len(data)} grid cells")
            if data:
                logger.info(f"Sample grid cell: {data[0]}")
        
        return {"data": data}
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
