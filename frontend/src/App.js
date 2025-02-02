import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, PolygonLayer, LineLayer } from '@deck.gl/layers';
import { DataFilterExtension } from '@deck.gl/extensions';
import { Map, ImageOverlay, Source, Layer } from 'react-map-gl';
import { scaleLinear } from 'd3-scale';
import './styles/Layout.css';
import GL from '@luma.gl/constants';

const MAPBOX_TOKEN = 'pk.eyJ1IjoiYWxpc2gtZXIiLCJhIjoiY20zNWc2aTFpMDN0ZDJrczNxYWJ0bWh2cyJ9.iZ8CltDHfWFpQjmcAewVKw';

const INITIAL_VIEW_STATE = {
  latitude: 0,
  longitude: 0,
  zoom: 2,
  pitch: 0,
  bearing: 0
};

const mapStyles = {
  'Satellite': {
    labeled: 'mapbox://styles/mapbox/satellite-streets-v12',
    unlabeled: 'mapbox://styles/mapbox/satellite-v9'
  },
  'Light': {
    labeled: 'mapbox://styles/mapbox/light-v11',
    unlabeled: 'mapbox://styles/mapbox/light-v11'
  },
  'Dark': {
    labeled: 'mapbox://styles/mapbox/dark-v11',
    unlabeled: 'mapbox://styles/mapbox/dark-v11'
  }
};

function App() {
  const [data, setData] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [mapStyle, setMapStyle] = useState(mapStyles.Satellite);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [viewMode, setViewMode] = useState('point'); // 'polygon' or 'point'
  const [hoveredObject, setHoveredObject] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [landCoverVisible, setLandCoverVisible] = useState(false);
  const [landCoverData, setLandCoverData] = useState(null);
  const [landCoverOpacity, setLandCoverOpacity] = useState(0.5);
  const [isGlobeMode, setIsGlobeMode] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [currentBaseMap, setCurrentBaseMap] = useState('Satellite');
  const deckRef = React.useRef();
  const [tempStartDate, setTempStartDate] = useState('');
  const [tempEndDate, setTempEndDate] = useState('');

  // Move validData filtering to component level
  const validData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    return data.filter(d => {
      if (viewMode === 'point') {
        return d && 
          d.position && 
          Array.isArray(d.position) && 
          d.position.length === 2 &&
          typeof d.xco2 === 'number' && 
          d.xco2 >= 380 && 
          d.xco2 <= 420;
      } else {
        return d && 
          d.position && 
          Array.isArray(d.position) && 
          d.position.length === 2 &&
          d.vertices && 
          Array.isArray(d.vertices) && 
          d.vertices.length === 4 &&
          typeof d.xco2 === 'number' && 
          d.xco2 >= 380 && 
          d.xco2 <= 420;
      }
    });
  }, [data, viewMode]);

  const fetchData = useCallback(async () => {
    try {
      let url = 'http://localhost:8000/data';
      if (deckRef.current?.deck) {
        const viewport = deckRef.current.deck.getViewports()[0];
        if (viewport) {
          let bounds;
          if (isGlobeMode) {
            const {longitude, latitude} = viewport;
            bounds = [
              longitude - 90, 
              Math.max(-90, latitude - 45),
              longitude + 90,
              Math.min(90, latitude + 45)
            ];
          } else {
            bounds = viewport.getBounds();
          }
          const boundStr = bounds.join(',');
          url += `?bounds=${boundStr}&zoom=${viewport.zoom}&view_mode=${viewMode}`;
          
          // Add date range parameters if dates are selected
          if (startDate) {
            url += `&start_date=${startDate}`;
          }
          if (endDate) {
            url += `&end_date=${endDate}`;
          }
          
          console.log('Fetching data:', {
            bounds: boundStr,
            zoom: viewport.zoom,
            viewMode,
            startDate,
            endDate
          });
        }
      }
      
      const response = await fetch(url);
      const result = await response.json();
      
      if (!result.data) {
        console.error('No data property in response:', result);
        return;
      }
      
      console.log(`Received ${result.data.length} ${viewMode} features`);
      if (result.data.length > 0) {
        console.log('Sample feature:', result.data[0]);
      }
      
      setData(result.data);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error.message);
    }
  }, [isGlobeMode, viewMode, startDate, endDate]);

  // Add debouncing to prevent too frequent updates
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchData();
    }, 500); // Wait 500ms after the last change before fetching
    
    return () => clearTimeout(timeoutId);
  }, [fetchData, landCoverVisible]);

  const handleViewStateChange = useCallback(({viewState}) => {
    setViewState(viewState);
    if (deckRef.current?.deck) {
      fetchData();
    }
  }, [fetchData]);

  console.log('Creating layers with data length:', data.length);
  // Move getPointRadius outside of useMemo
  const getPointRadius = useCallback((zoom) => {
    if (zoom <= 3) return 100000;  // Large points for overview
    if (zoom <= 5) return 75000;   // Medium points
    return 50000;                  // Detailed view
  }, []);

  // Restore original createTrajectories function
  const createTrajectories = (points) => {
    const trajectories = [];
    let currentLine = [];
    
    // Sort points by time if available, or by longitude as fallback
    const sortedPoints = [...points].sort((a, b) => 
      (a.time || a.position[0]) - (b.time || b.position[0])
    );

    for (let i = 0; i < sortedPoints.length; i++) {
      const point = sortedPoints[i];
      const nextPoint = sortedPoints[i + 1];
      
      currentLine.push(point);

      // Start new line if there's a big gap or it's the last point
      if (!nextPoint || 
          Math.abs(nextPoint.position[0] - point.position[0]) > 1 || 
          Math.abs(nextPoint.position[1] - point.position[1]) > 1) {
        if (currentLine.length > 1) {
          trajectories.push([...currentLine]);
        }
        currentLine = [];
      }
    }
    
    return trajectories;
  };

  // Add grid size calculation based on zoom
  const getGridSize = useCallback((zoom) => {
    if (zoom <= 3) return 5.0;  // Large grid cells for overview
    if (zoom <= 5) return 2.0;  // Medium grid cells
    return 1.0;                 // Detailed grid cells
  }, []);

  const layers = useMemo(() => {
    if (!data || data.length === 0) return [];

    const colorScale = scaleLinear()
      .domain([380, 400, 420])
      .range([
        [0, 255, 0],    // Green for low XCO2
        [255, 255, 0],  // Yellow for medium XCO2
        [255, 0, 0]     // Red for high XCO2
      ]);

    const layers = [];

    if (isGlobeMode) {
      // Add trajectory lines in globe mode
      const trajectories = createTrajectories(validData);
      layers.push(
        new LineLayer({
          id: 'trajectories',
          data: trajectories,
          getPath: d => d.map(p => p.position),
          getColor: [255, 255, 255, 100],
          widthMinPixels: 2,
          widthMaxPixels: 4,
          parameters: {
            depthTest: true,
            depthMask: true
          }
        })
      );
    }

    if (viewMode === 'point') {
      layers.push(
        new ScatterplotLayer({
          id: 'points',
          data: validData,
          getPosition: d => d.position,
          getFillColor: d => colorScale(d.xco2),
          getRadius: getPointRadius(viewState.zoom),
          radiusMinPixels: 2,
          radiusMaxPixels: isGlobeMode ? 15 : 10,
          pickable: true,
          opacity: 0.8,
          parameters: {
            depthTest: isGlobeMode,
            depthMask: isGlobeMode,
            cull: isGlobeMode,
            cullFace: 1029
          },
          updateTriggers: {
            getFillColor: colorScale,
            getRadius: [viewState.zoom, isGlobeMode]
          }
        })
      );
    }

    if (viewMode === 'polygon') {
      console.log('Creating polygon layer with:', {
        dataLength: validData.length,
        sampleData: validData[0],
        zoom: viewState.zoom,
        vertices: validData[0]?.vertices
      });

      layers.push(
        new PolygonLayer({
          id: 'grid-cells',
          data: validData,
          getPolygon: d => {
            console.log('Processing polygon:', {
              sounding_id: d.sounding_id,
              vertices: d.vertices,
              position: d.position,
              xco2: d.xco2
            });
            return d.vertices;
          },
          getFillColor: d => colorScale(d.xco2),
          getLineColor: [255, 255, 255, 40],
          getLineWidth: 1,
          lineWidthMinPixels: 0.5,
          pickable: true,
          opacity: 0.8,
          stroked: true,
          filled: true,
          wireframe: false,
          parameters: {
            depthTest: isGlobeMode,
            depthMask: isGlobeMode,
            cull: isGlobeMode,
            cullFace: 1029
          },
          updateTriggers: {
            getFillColor: colorScale
          }
        })
      );
    }

    return layers;
  }, [data, validData, viewMode, viewState.zoom, isGlobeMode, getPointRadius]);

  const handleToggleSidebar = () => {
    if (isSidebarOpen) {
      // First hide the sidebar
      setIsSidebarOpen(false);
    } else {
      // Show the sidebar
      setIsSidebarOpen(true);
    }
  };

  const getDistanceScale = (zoom) => {
    // Base scale at zoom level 0 (roughly 40075km or 24901mi at equator)
    const baseScale = 40075;
    const scale = baseScale / Math.pow(2, zoom);
    
    // Choose appropriate round numbers for the scale
    let distance;
    if (scale > 1000) distance = Math.round(scale / 1000) * 1000;
    else if (scale > 100) distance = Math.round(scale / 100) * 100;
    else if (scale > 10) distance = Math.round(scale / 10) * 10;
    else distance = Math.round(scale);
    
    return {
      km: distance,
      mi: Math.round(distance * 0.621371) // Convert km to miles
    };
  };

  const MapScale = ({ zoom }) => {
    const scale = getDistanceScale(zoom);
    
    return (
      <div className="map-scale">
        <h3>Scale (zoom: {zoom.toFixed(1)})</h3>
        <div className="scale-bar"></div>
        <div className="scale-labels">
          <span>0</span>
          <span>{scale.km} km ({scale.mi} mi)</span>
        </div>
      </div>
    );
  };

  // Add this function near the top of the App component
  const parseSoundingDate = (sounding_id) => {
    if (!sounding_id) return null;
    
    const str = sounding_id.toString();
    if (str.length < 14) return null; // Ensure we have enough digits
    
    const year = str.slice(0, 4);
    const month = str.slice(4, 6);
    const day = str.slice(6, 8);
    const hour = str.slice(8, 10);
    const minute = str.slice(10, 12);
    const second = str.slice(12, 14);
    
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  };

  // Update the getTooltip function
  const getTooltip = ({object}) => {
    if (!object) return null;
    
    const date = parseSoundingDate(object.sounding_id);
    
    return {
      html: `
        <div style="padding: 8px;">
          <div>XCO2: ${object.xco2.toFixed(2)} ppm</div>
          <div>Location: ${object.position[1].toFixed(2)}°, ${object.position[0].toFixed(2)}°</div>
          ${date ? `<div>Date: ${date}</div>` : ''}
        </div>
      `
    };
  };

  const DataCount = () => (
    <div className="view-mode-selector">
      <h3>Data Points</h3>
      <div className="data-count">
        Raw: {data?.length || 0}
        <br />
        Valid: {validData?.length || 0}
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  );

  useEffect(() => {
    if (data.length > 0) {
      console.log('Sample data point:', data[0]);
      console.log('Total data points:', data.length);
      if (data[0]) {
        console.log('Position:', data[0].position);
        console.log('Vertices:', data[0].vertices);
        console.log('XCO2:', data[0].xco2);
      }
    }
  }, [data]);

  // Add this useEffect to verify data structure
  useEffect(() => {
    if (data.length > 0) {
        const sample = data[0];
        console.log('Data structure check:', {
            hasPosition: !!sample.position,
            positionType: Array.isArray(sample.position),
            positionLength: sample.position?.length,
            hasVertices: !!sample.vertices,
            verticesType: Array.isArray(sample.vertices),
            verticesLength: sample.vertices?.length,
            xco2Value: sample.xco2,
            fullSample: sample
        });
    }
  }, [data]);

  // Add this function to create the raster layer
  const getLandCoverLayer = useCallback(() => {
    if (!landCoverData) return null;

    return {
      id: 'land-cover-layer',
      type: 'raster',
      paint: {
        'raster-opacity': 0.7
      }
    };
  }, [landCoverData]);

  // Add this effect to monitor land cover data changes
  useEffect(() => {
    console.log('Land cover data updated:', {
      hasData: !!landCoverData,
      bounds: landCoverData?.bounds,
      metadata: landCoverData?.metadata
    });
  }, [landCoverData]);

  const LandCoverLegend = () => (
    <div className="legend land-cover-legend">
      <h3>Land Cover</h3>
      <div className="legend-items horizontal">
        <div className="legend-item">
          <span className="color-box" style={{backgroundColor: '#90ee90'}}></span>
          <span>Wood</span>
        </div>
        <div className="legend-item">
          <span className="color-box" style={{backgroundColor: '#98fb98'}}></span>
          <span>Grass</span>
        </div>
        <div className="legend-item">
          <span className="color-box" style={{backgroundColor: '#deb887'}}></span>
          <span>Crop</span>
        </div>
        <div className="legend-item">
          <span className="color-box" style={{backgroundColor: '#d2b48c'}}></span>
          <span>Scrub</span>
        </div>
        <div className="legend-item">
          <span className="color-box" style={{backgroundColor: '#ffffff'}}></span>
          <span>Snow</span>
        </div>
      </div>
    </div>
  );

  // Also add a debug log to verify when the layer should be visible
  useEffect(() => {
    console.log('Land cover visibility changed:', landCoverVisible);
  }, [landCoverVisible]);

  const getCurrentMapStyle = useCallback(() => {
    return mapStyles[currentBaseMap][showLabels ? 'labeled' : 'unlabeled'];
  }, [currentBaseMap, showLabels]);

  const handleBaseMapChange = (value) => {
    setCurrentBaseMap(value);
  };

  useEffect(() => {
    console.log('Data validation:', {
      rawCount: data?.length || 0,
      validCount: validData?.length || 0,
      viewMode,
      sampleRaw: data?.[0],
      sampleValid: validData?.[0]
    });
  }, [data, validData, viewMode]);

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-section">
          <h1>Global xCO<sub>2</sub> Levels</h1>
        </div>
      </header>

      <main className="main-content">
        <div className="map-container">
          <DeckGL
            ref={deckRef}
            layers={layers}
            initialViewState={INITIAL_VIEW_STATE}
            controller={true}
            onViewStateChange={handleViewStateChange}
            getTooltip={getTooltip}
          >
            <Map
              mapboxAccessToken={MAPBOX_TOKEN}
              mapStyle={getCurrentMapStyle()}
              projection={isGlobeMode ? 'globe' : 'mercator'}
              fog={{
                range: isGlobeMode ? [0.5, 10] : [0, 0],
                color: 'white',
                'horizon-blend': 0.1
              }}
            >
              {landCoverVisible && (
                <Source
                  id="landcover-source"
                  type="vector"
                  url="mapbox://mapbox.mapbox-terrain-v2"
                >
                  <Layer
                    id="landcover-wood"
                    type="fill"
                    source-layer="landcover"
                    filter={['==', 'class', 'wood']}
                    paint={{
                      'fill-color': '#90ee90',
                      'fill-opacity': landCoverOpacity
                    }}
                  />
                  <Layer
                    id="landcover-grass"
                    type="fill"
                    source-layer="landcover"
                    filter={['==', 'class', 'grass']}
                    paint={{
                      'fill-color': '#98fb98',
                      'fill-opacity': landCoverOpacity
                    }}
                  />
                  <Layer
                    id="landcover-crop"
                    type="fill"
                    source-layer="landcover"
                    filter={['==', 'class', 'crop']}
                    paint={{
                      'fill-color': '#deb887',
                      'fill-opacity': landCoverOpacity
                    }}
                  />
                  <Layer
                    id="landcover-scrub"
                    type="fill"
                    source-layer="landcover"
                    filter={['==', 'class', 'scrub']}
                    paint={{
                      'fill-color': '#d2b48c',
                      'fill-opacity': landCoverOpacity
                    }}
                  />
                  <Layer
                    id="landcover-snow"
                    type="fill"
                    source-layer="landcover"
                    filter={['==', 'class', 'snow']}
                    paint={{
                      'fill-color': '#ffffff',
                      'fill-opacity': landCoverOpacity
                    }}
                  />
                </Source>
              )}
            </Map>
          </DeckGL>

          <MapScale zoom={viewState.zoom} />

          <div className="legend">
            <h3>xCO<sub>2</sub> (ppm)</h3>
            <div className="color-scale"></div>
            <div className="scale-labels">
              <span>380</span>
              <span>400</span>
              <span>420</span>
            </div>
          </div>

          {landCoverVisible && <LandCoverLegend />}

          {!isSidebarOpen && (
            <button 
              className="sidebar-toggle"
              onClick={handleToggleSidebar}
            >
              <span>Data Information</span>
            </button>
          )}

          <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
            <div className="sidebar-header">
              <h2>Data Information</h2>
              <button className="close-button" onClick={handleToggleSidebar}>
                ×
              </button>
            </div>
            
            <div className="view-mode-selector">
              <h3>View Mode</h3>
              <div className="toggle-switch">
                <input
                  type="radio"
                  id="point"
                  name="view-mode"
                  value="point"
                  checked={viewMode === 'point'}
                  onChange={(e) => setViewMode(e.target.value)}
                />
                <label htmlFor="point">Points</label>
                
                <input
                  type="radio"
                  id="polygon"
                  name="view-mode"
                  value="polygon"
                  checked={viewMode === 'polygon'}
                  onChange={(e) => setViewMode(e.target.value)}
                />
                <label htmlFor="polygon">Grid Cells</label>
              </div>
              {viewMode === 'polygon' && (
                <div className="source-note">
                  Note: Grid cells are only visible at zoom level 4 or higher
                </div>
              )}
            </div>

            <div className="view-mode-selector">
              <h3>Base Map</h3>
              <div className="toggle-switch">
                <input
                  type="radio"
                  id="basemap-satellite"
                  name="base-map"
                  value="Satellite"
                  checked={currentBaseMap === 'Satellite'}
                  onChange={(e) => handleBaseMapChange(e.target.value)}
                />
                <label htmlFor="basemap-satellite">Satellite</label>
                
                <input
                  type="radio"
                  id="basemap-light"
                  name="base-map"
                  value="Light"
                  checked={currentBaseMap === 'Light'}
                  onChange={(e) => handleBaseMapChange(e.target.value)}
                />
                <label htmlFor="basemap-light">Light</label>
                
                <input
                  type="radio"
                  id="basemap-dark"
                  name="base-map"
                  value="Dark"
                  checked={currentBaseMap === 'Dark'}
                  onChange={(e) => handleBaseMapChange(e.target.value)}
                />
                <label htmlFor="basemap-dark">Dark</label>
              </div>

              <div className="globe-toggle">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={isGlobeMode}
                    onChange={(e) => setIsGlobeMode(e.target.checked)}
                  />
                  <span className="slider round"></span>
                </label>
                <span className="globe-label">Globe View</span>
              </div>

              <div className={`toggle-container ${currentBaseMap === 'Satellite' ? 'visible' : ''}`}>
                <div className="globe-toggle">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={(e) => setShowLabels(e.target.checked)}
                    />
                    <span className="slider round"></span>
                  </label>
                  <span className="globe-label">Show Labels</span>
                </div>
              </div>
            </div>

            {selectedObject && (
              <div className="location-info">
                <h3>Selected Location</h3>
                <div className="info-content">
                  <p><strong>Coordinates:</strong> {selectedObject.latitude.toFixed(2)}°, {selectedObject.longitude.toFixed(2)}°</p>
                  <p><strong>XCO2:</strong> {selectedObject.xco2.toFixed(2)} ppm</p>
                  <p><strong>Date:</strong> {new Date(selectedObject.date).toLocaleString()}</p>
                  <p><strong>Quality Flag:</strong> {selectedObject.quality_flag === 0 ? 'Good' : 'Poor'}</p>
                </div>
              </div>
            )}

            <div className="date-filters">
              <h3>Date Range</h3>
              <div className="date-input">
                <label>Start Date:</label>
                <input 
                  type="date"
                  value={tempStartDate}
                  onChange={(e) => setTempStartDate(e.target.value)}
                />
              </div>
              <div className="date-input">
                <label>End Date:</label>
                <input 
                  type="date"
                  value={tempEndDate}
                  onChange={(e) => setTempEndDate(e.target.value)}
                />
              </div>
              <div className="toggle-switch">
                <input
                  type="radio"
                  id="apply-dates"
                  name="apply-dates"
                  checked={false}
                  readOnly
                />
                <label 
                  htmlFor="apply-dates"
                  onClick={() => {
                    setStartDate(tempStartDate);
                    setEndDate(tempEndDate);
                  }}
                  style={{ color: '#000' }}
                >
                  Apply
                </label>
              </div>
            </div>

            <div className="view-mode-selector">
              <h3>Land Cover</h3>
              <div className="toggle-switch">
                <input
                  type="radio"
                  id="landcover-off"
                  name="land-cover"
                  value="off"
                  checked={!landCoverVisible}
                  onChange={() => setLandCoverVisible(false)}
                />
                <label htmlFor="landcover-off">Off</label>
                
                <input
                  type="radio"
                  id="landcover-on"
                  name="land-cover"
                  value="on"
                  checked={landCoverVisible}
                  onChange={() => {
                    console.log('Toggling land cover ON');
                    setLandCoverVisible(true);
                  }}
                />
                <label htmlFor="landcover-on">On</label>
              </div>
              
              <div className={`opacity-slider-container ${landCoverVisible ? 'visible' : ''}`}>
                <div className="opacity-slider">
                  <label htmlFor="opacity">Opacity: {landCoverOpacity.toFixed(2)}</label>
                  <input
                    type="range"
                    id="opacity"
                    min="0"
                    max="1"
                    step="0.01"
                    value={landCoverOpacity}
                    onChange={(e) => setLandCoverOpacity(parseFloat(e.target.value))}
                  />
                  <div className="source-note">
                    Data source: Mapbox Terrain v2
                  </div>
                </div>
              </div>
              
              {landCoverVisible && landCoverData?.metadata && (
                <div className="land-cover-info">
                  <p><strong>Source:</strong> {landCoverData.metadata.source}</p>
                  <p><strong>Resolution:</strong> {landCoverData.metadata.resolution}</p>
                  <p><strong>Year:</strong> {landCoverData.metadata.reference_year}</p>
                  <p><strong>Accuracy:</strong> {landCoverData.metadata.accuracy}</p>
                </div>
              )}
            </div>

            <DataCount />
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
