import netCDF4 as nc
import numpy as np
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class OCO2DataProcessor:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
        self.zoom_thresholds = {
            'grid_visible': 4,    # Lowered from 5 to make grids visible sooner
            'dense_points': 4     # Show all points when zoomed in past this
        }

    def get_data_for_viewport(self, bounds, zoom, view_mode='point', start_date=None, end_date=None):
        """Get data with appropriate detail level based on zoom"""
        minlon, minlat, maxlon, maxlat = bounds
        logger.info(f"Processing data for zoom {zoom}, mode: {view_mode}")

        if view_mode == 'polygon':
            # Only return grid cells if zoomed in enough
            if zoom < self.zoom_thresholds['grid_visible']:
                logger.info(f"Zoom level {zoom} too low for grid view (min: {self.zoom_thresholds['grid_visible']})")
                return []
            
            logger.info(f"Getting grid cells for bounds: {bounds}")
            cells = self._get_gridded_data(bounds, start_date, end_date)
            logger.info(f"Retrieved {len(cells)} grid cells")
            if cells:
                logger.info(f"Sample cell vertices: {cells[0]['vertices']}")
            return cells
        else:
            return self._get_point_data(bounds, zoom, start_date, end_date)

    def _parse_sounding_date(self, sounding_id):
        """Extract date from sounding ID"""
        str_id = str(sounding_id)
        if len(str_id) < 14:
            return None
        year = int(str_id[0:4])
        month = int(str_id[4:6])
        day = int(str_id[6:8])
        return f"{year}-{month:02d}-{day:02d}"

    def _filter_by_date(self, sounding_ids, start_date=None, end_date=None):
        """Return mask for soundings within date range"""
        if not start_date and not end_date:
            return np.ones_like(sounding_ids, dtype=bool)
        
        dates = np.array([self._parse_sounding_date(sid) for sid in sounding_ids])
        mask = np.ones_like(sounding_ids, dtype=bool)
        
        if start_date:
            mask &= (dates >= start_date)
        if end_date:
            mask &= (dates <= end_date)
            
        return mask

    def _get_point_data(self, bounds, zoom, start_date=None, end_date=None):
        """Return point data with density based on zoom level"""
        minlon, minlat, maxlon, maxlat = bounds
        points = []

        # Determine sampling rate based on zoom
        if zoom < self.zoom_thresholds['dense_points']:
            sample_rate = 20
            bounds_check = False
        else:
            sample_rate = 1
            bounds_check = True

        for file_path in self.data_dir.glob('*.nc4'):
            try:
                with nc.Dataset(file_path) as dataset:
                    lats = dataset.variables['latitude'][:]
                    lons = dataset.variables['longitude'][:]
                    xco2 = dataset.variables['xco2'][:]
                    quality_flags = dataset.variables['xco2_quality_flag'][:]
                    sounding_ids = dataset.variables['sounding_id'][:]

                    # Add date filtering to quality filter
                    mask = (quality_flags == 0) & (xco2 >= 380) & (xco2 <= 420)
                    date_mask = self._filter_by_date(sounding_ids, start_date, end_date)
                    mask &= date_mask

                    # Add bounds check only when zoomed in
                    if bounds_check:
                        mask &= (
                            (lons >= minlon) & (lons <= maxlon) &
                            (lats >= minlat) & (lats <= maxlat)
                        )

                    indices = np.where(mask)[0][::sample_rate]
                    
                    for idx in indices:
                        if not bounds_check and not (
                            minlon <= lons[idx] <= maxlon and
                            minlat <= lats[idx] <= maxlat
                        ):
                            continue

                        point = {
                            'position': [float(lons[idx]), float(lats[idx])],
                            'xco2': float(xco2[idx]),
                            'sounding_id': str(sounding_ids[idx])
                        }
                        points.append(point)

            except Exception as e:
                logger.error(f"Error processing {file_path}: {str(e)}")
                continue

        logger.info(f"Returning {len(points)} points")
        return points

    def _get_gridded_data(self, bounds, start_date=None, end_date=None):
        """Return grid cells using OCO-2 footprint vertices as polygon patches"""
        minlon, minlat, maxlon, maxlat = bounds
        grid_cells = []

        for file_path in self.data_dir.glob('*.nc4'):
            try:
                with nc.Dataset(file_path) as dataset:
                    lats = dataset.variables['latitude'][:]
                    lons = dataset.variables['longitude'][:]
                    xco2 = dataset.variables['xco2'][:]
                    quality_flags = dataset.variables['xco2_quality_flag'][:]
                    sounding_ids = dataset.variables['sounding_id'][:]
                    
                    # Get vertex coordinates
                    vertex_lats = dataset.variables['vertex_latitude'][:]
                    vertex_lons = dataset.variables['vertex_longitude'][:]

                    # Add date filtering to the mask
                    mask = (
                        (lons >= minlon) & (lons <= maxlon) &
                        (lats >= minlat) & (lats <= maxlat) &
                        (quality_flags == 0) & 
                        (xco2 >= 380) & (xco2 <= 420)
                    )
                    date_mask = self._filter_by_date(sounding_ids, start_date, end_date)
                    mask &= date_mask

                    valid_indices = np.where(mask)[0]

                    # Process each valid sounding
                    for idx in valid_indices:
                        # Create vertices array by stacking lon/lat pairs
                        # This follows the reference implementation's approach
                        vertices = []
                        for i in range(4):
                            vertices.append([
                                float(vertex_lons[idx][i]),
                                float(vertex_lats[idx][i])
                            ])
                        
                        # Ensure vertices are in counterclockwise order
                        # Bottom-left, bottom-right, top-right, top-left
                        vertices = [
                            vertices[0],  # Bottom-left
                            vertices[1],  # Bottom-right
                            vertices[2],  # Top-right
                            vertices[3]   # Top-left
                        ]

                        cell = {
                            'position': [float(lons[idx]), float(lats[idx])],
                            'vertices': vertices,
                            'xco2': float(xco2[idx]),
                            'sounding_id': str(sounding_ids[idx])
                        }
                        grid_cells.append(cell)

                        # Debug logging for first few cells
                        if len(grid_cells) < 3:
                            logger.info(f"Footprint for sounding {sounding_ids[idx]}:")
                            logger.info(f"  Center: {cell['position']}")
                            logger.info(f"  XCO2: {cell['xco2']}")
                            logger.info(f"  Vertices: {vertices}")

            except Exception as e:
                logger.error(f"Error processing {file_path}: {str(e)}")
                continue

        logger.info(f"Created {len(grid_cells)} polygon footprints")
        return grid_cells
