// Estado de la Aplicación
const appState = {
    locations: {},
    currentData: null,
    currentLocation: null,
    weatherMap: null,
    csvLoading: false
};

// Variables globales
let weatherMarkers = [];

// Escalas de color para la visualización del mapa
const attributeColors = {
    TMax: ['#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
    TMin: ['#08306b', '#08519c', '#2171b5', '#4292c6', '#9ecae1', '#fdae61'],
    P_Lluvia: ['#E6F2FF', '#6BB9FF', '#FFD966', '#FF8C66', '#FF4D4D'],
    mm: ['#E6F7FF', '#6BB5FF', '#3A66FF', '#2600ffff', '#aa149eff'],
    VientoMax: ['#c4ff76ff', '#4bd12aff', '#0aa805ff', '#018508ff', '#014607ff'],
    Rafagas: ['#f189ffff', '#ff32e4ff', '#b8007aff', '#ff0000ff']
};

// Inicializar la aplicación
function initApp() {
    console.log("Inicializando la aplicación...");
    if (!localStorage.getItem('UbicacionClima')) {
        localStorage.setItem('UbicacionClima', JSON.stringify({}));
    }
    appState.locations = JSON.parse(localStorage.getItem('UbicacionClima'));
    
    updateDateTime();
    setInterval(updateDateTime, 60000);
    updateLocationDropdowns();
    
    const firstLocation = Object.keys(appState.locations)[0];
    if (firstLocation) loadTableData(firstLocation);
    
    setupEventListeners();
    setupLogoModal();
}
// Función para configurar el modal del logo
function setupLogoModal() {
    const navbarBrand = document.querySelector('.navbar-brand');
    const overlay = document.getElementById('logoOverlay');
    
    if (!navbarBrand || !overlay) return;

    // Clic en el logo "Modo"
    navbarBrand.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });
    
    // Clic fuera del logo "modal"
    overlay.addEventListener('click', function(e) {
        if (e.target === this) {
            this.style.display = 'none';
            document.body.style.overflow = '';
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay.style.display === 'flex') {
            overlay.style.display = 'none';
            document.body.style.overflow = '';
        }
    });
}

// Eventos de aplicación
function setupEventListeners() {
    document.getElementById('loadDataBtn').addEventListener('click', () => {
        const location = document.getElementById('locationSelect').value;
        loadTableData(location);
    });
    
    document.getElementById('loadCsvBtn').addEventListener('click', handleCsvUpload);
    document.getElementById('downloadCsvBtn').addEventListener('click', downloadDataAsCsv);
    document.getElementById('updateGraphBtn').addEventListener('click', updateGraph);
    document.getElementById('updateStatsBtn').addEventListener('click', updateStats);
    
    document.getElementById('csvFileInput').addEventListener('change', function() {
        document.getElementById('csvFeedback').textContent = '';
        document.getElementById('csvFeedback').classList.remove('text-success', 'text-danger');
    });
    
    document.getElementById('graphLocationSelect').addEventListener('change', updateGraph);
    document.getElementById('statsLocationSelect').addEventListener('change', updateStats);

    // Eventos de pestañas
    document.querySelectorAll('.nav-tabs button').forEach(tab => {
        tab.addEventListener('shown.bs.tab', (e) => {
            if (e.target.id === 'graphs-tab') updateGraph();
            if (e.target.id === 'stats-tab') updateStats();
            if (e.target.id === 'map-tab') initMap();
        });
    });
}


// Agregar a setupEventListeners()
document.getElementById('loadGeojsonBtn').addEventListener('click', () => {
    document.getElementById('geojsonFileInput').click();
});

document.getElementById('geojsonFileInput').addEventListener('change', handleGeojsonUpload);
document.getElementById('removeGeojsonBtn').addEventListener('click', removeGeojsonLayer);
document.getElementById('toggleGeojsonBtn').addEventListener('click', toggleGeojsonVisibility);

// Función para manejo de GeoJSON
function handleGeojsonUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const geojsonData = JSON.parse(e.target.result);
            displayGeojsonOnMap(geojsonData);
            document.getElementById('geojsonControls').classList.remove('d-none');
        } catch (error) {
            alert('Error al procesar el archivo GeoJSON: ' + error.message);
        }
    };
    reader.onerror = function() {
        alert('Error al leer el archivo');
    };
    reader.readAsText(file);
}

// Variables globales
let interpolationLayer = null;

// Función principal de interpolación
async function runInterpolation() {
    if (!geojsonLayer || !geojsonVisible) {
        alert('Carga y muestra una capa GeoJSON primero');
        return;
    }

    const selectedDayIndex = document.getElementById('mapDaySelect').value || 0;
    const selectedAttribute = document.getElementById('mapAttributeSelect').value;
    const geojson = geojsonLayer.toGeoJSON();
    
    if (!geojson.features.length) {
        alert('El GeoJSON no contiene características válidas');
        return;
    }

    // Indicador de carga
    const loadingControl = L.control({position: 'bottomright'});
    loadingControl.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-loading');
        div.innerHTML = '<div class="spinner-border text-primary"></div> Interpolando...';
        return div;
    };
    loadingControl.addTo(appState.weatherMap);

    try {
        // Colectar puntos dentro del GeoJSON
        const points = [];
        for (const [id, location] of Object.entries(appState.locations)) {
            const pt = turf.point([location.lon, location.lat]);
            if (turf.booleanPointInPolygon(pt, geojson.features[0])) {
                const weatherData = await fetchWeatherData(location.lat, location.lon);
                const processedData = processWeatherData(weatherData);
                const value = parseFloat(processedData[selectedDayIndex][selectedAttribute]) || 0;
                points.push(turf.point([location.lon, location.lat], { value }));
            }
        }

        if (points.length < 3) {
            throw new Error(`Se necesitan al menos 3 puntos. Encontrados: ${points.length}`);
        }

        // Crear colección de puntos y crear una cuadrícula de interpolación
        const pointCollection = turf.featureCollection(points);
        const bbox = turf.bbox(geojson);
        const cellSize = 0.03; // Grados (~3.3km en el ecuador)
        const grid = turf.pointGrid(bbox, cellSize, { units: 'degrees' });

        // Agregar valores interpolados a la cuadrícula
        grid.features.forEach(point => {
            if (turf.booleanPointInPolygon(point, geojson.features[0])) {
                point.properties.value = interpolateValue(point, pointCollection);
            }
        });

        // Crear capa de visualización
        createInterpolationLayer(grid, selectedAttribute);

    } catch (error) {
        console.error("Error de interpolación:", error);
        alert(`Error: ${error.message}`);
    } finally {
        appState.weatherMap.removeControl(loadingControl);
    }
}

// Función de interpolación IDW
function interpolateValue(targetPoint, points, power = 15) {
    let numerator = 0;
    let denominator = 0;

    points.features.forEach(point => {
        const distance = turf.distance(targetPoint, point);
        if (distance === 0) return point.properties.value;
        
        const weight = 1 / Math.pow(distance, power);
        numerator += weight * point.properties.value;
        denominator += weight;
    });

    return numerator / denominator;
}

// Crear capa de visualización de interpolación
function createInterpolationLayer(grid, attribute) {
    if (interpolationLayer) {
        appState.weatherMap.removeLayer(interpolationLayer);
    }

    // Obtener rango de valores
    const values = grid.features
        .filter(f => f.properties.value !== undefined)
        .map(f => f.properties.value);
    
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const colorScale = attributeColors[attribute];

    // Crear capa de interpolación
    interpolationLayer = L.geoJSON(grid, {
        pointToLayer: (feature, latlng) => {
            const value = feature.properties.value;
            const ratio = Math.min(1, Math.max(0, (value - minVal) / (maxVal - minVal)));
            const colorIdx = Math.floor(ratio * (colorScale.length - 1));
            const color = colorScale[colorIdx];
            
            return L.circleMarker(latlng, {
                radius: 4,
                fillColor: color,
                color: 'rgba(0, 0, 0, 0.02)',
                weight: 1,
                fillOpacity: 0.6
            });
        }
    }).addTo(appState.weatherMap);

    // Actualizar leyenda
    updateMapLegend(attribute, minVal, maxVal);
}

// Botón de interpolación
document.getElementById('interpolateBtn').addEventListener('click', runInterpolation);

// Limpiar interpolación al cambiar parámetros
document.getElementById('mapDaySelect').addEventListener('change', () => {
    if (interpolationLayer) {
        appState.weatherMap.removeLayer(interpolationLayer);
        interpolationLayer = null;
    }
});

document.getElementById('mapAttributeSelect').addEventListener('change', () => {
    if (interpolationLayer) {
        appState.weatherMap.removeLayer(interpolationLayer);
        interpolationLayer = null;
    }
});
// 

// Función para eliminar la capa de interpolación
function removeInterpolationLayer() {
    if (interpolationLayer) {
        appState.weatherMap.removeLayer(interpolationLayer);
        interpolationLayer = null;
    }
}

function displayGeojsonOnMap(geojsonData) {
    // Limpiar capa GeoJSON existente
    if (geojsonLayer) {
        appState.weatherMap.removeLayer(geojsonLayer);
    }

    // Crear nueva capa con estilo personalizado
    geojsonLayer = L.geoJSON(geojsonData, {
        style: function(feature) {
            return {
                color: '#000000ff',
                weight: 3,
                opacity: 1,
                fillOpacity: 0,
                fillColor: '#ffffff'
            };
        },
        onEachFeature: function(feature, layer) {
            // Agregar popup con propiedades de la característica si están disponibles
            if (feature.properties) {
                let popupContent = '<div style="max-height:200px;overflow-y:auto;">';
                for (const key in feature.properties) {
                    popupContent += `<b>${key}:</b> ${feature.properties[key]}<br>`;
                }
                popupContent += '</div>';
                layer.bindPopup(popupContent);
            }
        }
    }).addTo(appState.weatherMap);

    // Ajustar el mapa para mostrar la capa GeoJSON
    appState.weatherMap.fitBounds(geojsonLayer.getBounds());
}

function removeGeojsonLayer() {
    if (geojsonLayer) {
        appState.weatherMap.removeLayer(geojsonLayer);
        geojsonLayer = null;
        document.getElementById('geojsonControls').classList.add('d-none');
        document.getElementById('geojsonFileInput').value = '';
    }
}

function toggleGeojsonVisibility() {
    if (geojsonLayer) {
        if (geojsonVisible) {
            appState.weatherMap.removeLayer(geojsonLayer);
        } else {
            geojsonLayer.addTo(appState.weatherMap);
        }
        geojsonVisible = !geojsonVisible;
    }
}

// Variables globales
let geojsonLayer = null;
let geojsonVisible = true;

// Manejo de CSV
async function handleCsvUpload() {
    const fileInput = document.getElementById('csvFileInput');
    const feedbackEl = document.getElementById('csvFeedback');
    const spinner = document.getElementById('csvSpinner');
    const loadBtn = document.getElementById('loadCsvBtn');

    if (!fileInput.files.length) {
        showFeedback(feedbackEl, 'Seleccione un archivo CSV', 'danger');
        return;
    }

    if (appState.csvLoading) return;
    appState.csvLoading = true;
    
    spinner.classList.remove('d-none');
    loadBtn.disabled = true;
    feedbackEl.textContent = '';

    try {
        const file = fileInput.files[0];
        const result = await processCsvFile(file);
        
        if (result.success) {
            // Filtrar ubicaciones que ya existen
            const newLocations = {};
            let addedCount = 0;
            
            for (const [id, location] of Object.entries(result.locations)) {
                if (!appState.locations[id]) {
                    newLocations[id] = location;
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                // Actualizar el estado de la aplicación con nuevas ubicaciones
                appState.locations = { ...appState.locations, ...newLocations };
                localStorage.setItem('UbicacionClima', JSON.stringify(appState.locations));

                // Actualizar la interfaz de usuario
                updateLocationDropdowns();

                // Mostrar mensaje de éxito con el conteo
                showFeedback(
                    feedbackEl, 
                    `¡Datos cargados exitosamente! ${addedCount} ubicación(es) añadida(s)`, 
                    'success'
                );

                // Cargar la primera nueva ubicación si no hay ninguna seleccionada
                if (!appState.currentLocation) {
                    const firstNew = Object.keys(newLocations)[0];
                    loadTableData(firstNew);
                }
            } else {
                showFeedback(feedbackEl, 'El archivo no contenía ubicaciones nuevas', 'info');
            }
        } else {
            showFeedback(feedbackEl, `Error: ${result.message}`, 'danger');
        }
    } catch (error) {
        showFeedback(feedbackEl, `Error: ${error.message}`, 'danger');
    } finally {
        spinner.classList.add('d-none');
        loadBtn.disabled = false;
        appState.csvLoading = false;
        fileInput.value = '';
    }
}

function showFeedback(element, message, type) {
    element.textContent = message;
    element.className = 'form-text'; 
    element.classList.add(`text-${type}`);
    element.style.display = 'block';
    element.style.visibility = 'visible';
}

function processCsvFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                const lines = content.split('\n');
                const newLocations = {};
                let added = 0;
                let errors = [];
                
                lines.forEach((line, i) => {
                    try {
                        line = line.trim();
                        // Skip empty lines and comments
                        if (!line || line.startsWith('#') || line.startsWith('Nombre')) {
                            return;
                        }

                        // Manejo de separadores
                        let parts = line.includes(';') ?
                            line.split(';').map(p => p.trim()) :
                            line.split(',').map(p => p.trim());

                        // Validar que tengamos exactamente 3 valores
                        if (parts.length !== 3) {
                            errors.push(`Línea ${i+1}: Formato incorrecto (necesita 3 valores)`);
                            return;
                        }
                        
                        const [name, latStr, lonStr] = parts;

                        // Limpiar valores numéricos
                        const cleanLatStr = latStr.replace(',', '.');
                        const cleanLonStr = lonStr.replace(',', '.');
                        
                        const lat = parseFloat(cleanLatStr);
                        const lon = parseFloat(cleanLonStr);
                        
                        // Validar datos
                        if (!name || isNaN(lat) || isNaN(lon)) {
                            errors.push(`Línea ${i+1}: Datos inválidos (${line})`);
                            return;
                        }

                        // Validar rangos de coordenadas
                        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                            errors.push(`Línea ${i+1}: Coordenadas fuera de rango`);
                            return;
                        }
                        
                        // Crear ID a partir del nombre
                        const id = name.toLowerCase().replace(/\s+/g, '-');
                        
                        if (!appState.locations[id]) {
                            newLocations[id] = { name, lat, lon };
                            added++;
                        }
                    } catch (error) {
                        errors.push(`Línea ${i+1}: Error procesando - ${error.message}`);
                    }
                });
                
                resolve({
                    success: errors.length === 0,
                    locations: newLocations,
                    added,
                    message: errors.length > 0 ? 
                        `Errores encontrados: ${errors.join('; ')}` : 
                        'CSV procesado correctamente'
                });
            } catch (error) {
                resolve({
                    success: false,
                    message: `Error procesando archivo: ${error.message}`
                });
            }
        };
        
        reader.onerror = () => {
            resolve({
                success: false,
                message: 'Error al leer el archivo'
            });
        };
        
        reader.readAsText(file);
    });
}

// Descarga de datos CSV
function downloadDataAsCsv() {
    if (!appState.currentData || !appState.currentLocation) {
        alert('No hay datos para descargar. Por favor cargue datos primero.');
        return;
    }

    const location = appState.locations[appState.currentLocation];
    const now = new Date();
    const dateStr = formatDateForFilename(now);
    
    // Crear contenido CSV
    const headers = [
        'ID', 
        'Fecha', 
        'Temperatura Maxima (°C)', 
        'Temperatura Minima (°C)', 
        'Probabilidad Lluvia (%)', 
        'Precipitacion (mm)', 
        'Velocidad Viento (km/h)', 
        'Rafagas (km/h)', 
        'Direccion Viento'
    ];
    
    const rows = appState.currentData.map(item => [
        item.ID,
        item.Fecha,
        item.TMax,
        item.TMin,
        item.P_Lluvia,
        item.mm,
        item.VientoMax,
        item.Rafagas,
        item.DireccionViento
    ]);

    // Convertir a formato CSV
    let csvContent = headers.join(';') + '\r\n';
    rows.forEach(rowArray => {
        const row = rowArray.map(item => `"${item}"`).join(';');
        csvContent += row + '\r\n';
    });

    // Crear link de descarga
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Datos_Climaticos_${location.name.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function formatDateForFilename(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${year}${month}${day}`;
}

// Funciones de datos meteorológicos
async function loadTableData(locationId) {
    const location = appState.locations[locationId];
    if (!location) return;

    try {
        // Mostrar estados de carga
        document.getElementById('loadDataBtn').disabled = true;
        document.querySelector('#weatherTable tbody').innerHTML = 
            `<tr><td colspan="9" class="text-center py-4"><div class="spinner-border"></div></td></tr>`;
        document.getElementById('currentWeatherCard').innerHTML = 
            `<div class="text-center py-4"><div class="spinner-border text-info"></div></div>`;

        // Buscar datos meteorológicos
        const weatherData = await fetchWeatherData(location.lat, location.lon);

        // Mostrar clima actual
        displayCurrentWeather(weatherData);

        // Procesar datos de pronóstico diario
        appState.currentData = weatherData.daily.time.map((date, i) => ({
            ID: i + 1,
            Fecha: new Date(date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
            TMax: weatherData.daily.temperature_2m_max[i]?.toFixed(1) || 'N/A',
            TMin: weatherData.daily.temperature_2m_min[i]?.toFixed(1) || 'N/A',
            P_Lluvia: weatherData.daily.precipitation_probability_max[i] || '0',
            mm: weatherData.daily.precipitation_sum[i]?.toFixed(1) || '0',
            VientoMax: weatherData.daily.windspeed_10m_max[i]?.toFixed(1) || '0',
            Rafagas: weatherData.daily.windgusts_10m_max[i]?.toFixed(1) || '0',
            DireccionViento: convertWindDirection(weatherData.daily.winddirection_10m_dominant[i])
        }));
        
        appState.currentLocation = locationId;
        displayTableData(appState.currentData);
        document.getElementById('tableTitle').textContent = `Datos Climáticos - ${location.name}`;

        // Actualizar las demás pestañas si están activas
        if (document.getElementById('graphs-tab').classList.contains('active')) updateGraph();
        if (document.getElementById('stats-tab').classList.contains('active')) updateStats();
        if (document.getElementById('map-tab').classList.contains('active')) initMap();
        
    } catch (error) {
        console.error("Error loading data:", error);
        document.getElementById('currentWeatherCard').innerHTML = 
            `<div class="alert alert-danger">Error al cargar datos</div>`;
        document.querySelector('#weatherTable tbody').innerHTML = 
            `<tr><td colspan="9" class="text-center text-danger py-4">Error loading data</td></tr>`;
    } finally {
        document.getElementById('loadDataBtn').disabled = false;
    }
}

async function fetchWeatherData(lat, lon) {
    try {
        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&current=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,` +
            `windspeed_10m_max,windgusts_10m_max,winddirection_10m_dominant&timezone=auto&forecast_days=14`
        );
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}

function displayCurrentWeather(data) {
    const current = data.current;
    const card = document.getElementById('currentWeatherCard');
    
    card.innerHTML = `
        <div class="weather-current">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h4 class="mb-0">${current.temperature_2m}°C</h4>
                <i class="wi ${getWeatherIcon(current)}" style="font-size: 2.5rem;"></i>
            </div>
            <table class="table table-sm">
                <tr>
                    <td><i class="wi wi-raindrop"></i> Precipitación</td>
                    <td class="text-end">${current.precipitation} mm</td>
                </tr>
                <tr>
                    <td><i class="wi wi-strong-wind"></i> Viento</td>
                    <td class="text-end">${current.wind_speed_10m} km/h</td>
                </tr>
                <tr>
                    <td><i class="wi wi-wind-direction"></i> Dirección</td>
                    <td class="text-end">${convertWindDirection(current.wind_direction_10m)}</td>
                </tr>
                <tr>
                    <td><i class="wi wi-windy"></i> Ráfagas</td>
                    <td class="text-end">${current.wind_gusts_10m} km/h</td>
                </tr>
            </table>
            <div class="text-muted small mt-2">
                Actualizado: ${new Date().toLocaleTimeString('es-ES')}
            </div>
        </div>
    `;
}

function getWeatherIcon(currentData) {
    if (currentData.precipitation > 0) return 'wi-rain';
    if (currentData.wind_speed_10m > 20) return 'wi-strong-wind';
    return 'wi-day-sunny';
}

function convertWindDirection(degrees) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round(degrees / 22.5) % 16] || 'N/A';
}

function displayTableData(data) {
    const tableBody = document.querySelector('#weatherTable tbody');
    tableBody.innerHTML = data.map(item => `
        <tr>
            <td>${item.ID}</td>
            <td>${item.Fecha}</td>
            <td>${item.TMax}</td>
            <td>${item.TMin}</td>
            <td>${item.P_Lluvia}%</td>
            <td>${item.mm}mm</td>
            <td>${item.VientoMax}</td>
            <td>${item.Rafagas}</td>
            <td>${item.DireccionViento}</td>
        </tr>
    `).join('');
}

// Funciones de gráficos
async function updateGraph() {
    const locationId = document.getElementById('graphLocationSelect').value;
    if (!locationId) return;

    // Si la ubicación seleccionada es diferente, cargar sus datos primero
    if (appState.currentLocation !== locationId) {
        await loadTableData(locationId);
    }

    const location = appState.locations[locationId];
    if (!location || !appState.currentData) return;

    const attributes = [];
    if (document.getElementById('attr1').checked) attributes.push('TMax');
    if (document.getElementById('attr2').checked) attributes.push('TMin');
    if (document.getElementById('attr3').checked) attributes.push('P_Lluvia');
    if (document.getElementById('attr4').checked) attributes.push('mm');
    if (document.getElementById('attr5').checked) attributes.push('VientoMax');
    if (document.getElementById('attr6').checked) attributes.push('Rafagas');

    if (attributes.length === 0) {
        alert('Seleccione al menos un atributo');
        return;
    }

    createWeatherChart(attributes);
    document.getElementById('graphTitle').textContent = `Gráfica - ${location.name}`;
}

function createWeatherChart(attributes) {
    const data = appState.currentData;
    const traces = [];
    
    const colorMap = {
        'TMax': '#ff0000ff',
        'TMin': '#0004ffff',
        'P_Lluvia': '#eba328ff',
        'mm': '#00fddbff',
        'VientoMax': '#bf59d1ff',
        'Rafagas': '#670fffff'
    };
    
    const nameMap = {
        'TMax': 'Temp. Máx (°C)',
        'TMin': 'Temp. Mín (°C)',
        'P_Lluvia': 'Lluvia (%)',
        'mm': 'Precip. (mm)',
        'VientoMax': 'Viento (km/h)',
        'Rafagas': 'Ráfagas (km/h)'
    };
    
    attributes.forEach(attr => {
        traces.push({
            x: data.map(d => d.Fecha),
            y: data.map(d => parseFloat(d[attr])),
            name: nameMap[attr],
            type: 'lines+markers',
            line: { color: colorMap[attr], width: 3 },
            marker: { size: 8 }
        });
    });
    
    const layout = {
        title: 'Pronóstico 14 Días',
        xaxis: { 
            title: 'Fecha',
            tickangle: -45,
            type: 'category'
        },
        yaxis: { title: 'Valores' },
        legend: { 
            orientation: 'h',
            y: -0.3
        },
        margin: { t: 50, b: 100, l: 50, r: 50 },
        hovermode: 'x unified'
    };
    
    Plotly.newPlot('weatherChart', traces, layout);
}

// función de estadísticas
async function updateStats() {
    const locationId = document.getElementById('statsLocationSelect').value;
    if (!locationId) return;

    // Si la ubicación seleccionada es diferente, cargar sus datos primero
    if (appState.currentLocation !== locationId) {
        await loadTableData(locationId);
    }

    const location = appState.locations[locationId];
    if (!location || !appState.currentData) return;

    const data = appState.currentData;
    const statsDiv = document.getElementById('statsContent');

    const attributes = ['TMax', 'TMin', 'P_Lluvia', 'mm', 'VientoMax', 'Rafagas'];
    const nameMap = {
        'TMax': 'Temperatura Máxima (°C)',
        'TMin': 'Temperatura Mínima (°C)',
        'P_Lluvia': 'Probabilidad de Lluvia (%)',
        'mm': 'Precipitación (mm)',
        'VientoMax': 'Velocidad del Viento (km/h)',
        'Rafagas': 'Ráfagas Máximas (km/h)'
    };
    
    let statsHTML = `
        <h4 class="mb-4">Estadísticas - ${location.name}</h4>
        <div class="row">
    `;
    
    attributes.forEach(attr => {
        const values = data.map(d => parseFloat(d[attr])).filter(v => !isNaN(v));
        const min = Math.min(...values).toFixed(1);
        const max = Math.max(...values).toFixed(1);
        const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
        
        statsHTML += `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100">
                    <div class="card-header bg-light">
                        <h5 class="card-title mb-0">${nameMap[attr]}</h5>
                    </div>
                    <div class="card-body">
                        <table class="table table-sm mb-0">
                            <tr><td>Mínimo</td><td class="text-end">${min}</td></tr>
                            <tr><td>Máximo</td><td class="text-end">${max}</td></tr>
                            <tr><td>Promedio</td><td class="text-end">${avg}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        `;
    });
    
    statsHTML += `</div>`;
    statsDiv.innerHTML = statsHTML;
    document.getElementById('statsTitle').textContent = `Resumen Estadístico - ${location.name}`;
}

// Funciones de mapa
function initMap() {
    if (appState.weatherMap) {
        appState.weatherMap.invalidateSize();
        updateMapMarkers();
        return;
    }

    appState.weatherMap = L.map('weatherMap').setView([20.6345, -101.0528], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(appState.weatherMap);

    setupMapDaySelector();
    updateMapMarkers();

    document.getElementById('mapDaySelect').addEventListener('change', updateMapMarkers);
    document.getElementById('mapAttributeSelect').addEventListener('change', updateMapMarkers);
}

function setupMapDaySelector() {
    const select = document.getElementById('mapDaySelect');
    select.innerHTML = '';
    
    if (!appState.currentData) return;
    
    appState.currentData.forEach((day, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = day.Fecha;
        select.appendChild(option);
    });
}

async function updateMapMarkers() {
    const selectedDayIndex = document.getElementById('mapDaySelect').value || 0;
    const selectedAttribute = document.getElementById('mapAttributeSelect').value;

    // Limpiar marcadores existentes
    weatherMarkers.forEach(marker => appState.weatherMap.removeLayer(marker));
    weatherMarkers = [];
    
    // Mostrar estado de carga
    const loadingControl = L.control({position: 'bottomright'});
    loadingControl.onAdd = function() {
        this._div = L.DomUtil.create('div', 'map-loading');
        this._div.innerHTML = '<div class="spinner-border text-primary"></div> Cargando datos...';
        return this._div;
    };
    loadingControl.addTo(appState.weatherMap);
    
    try {
        // Buscar datos para todas las ubicaciones
        const locationsData = {};
        for (const [id, location] of Object.entries(appState.locations)) {
            const weatherData = await fetchWeatherData(location.lat, location.lon);
            locationsData[id] = processWeatherData(weatherData);
        }

        // Calcular valores min/max para la escala de colores
        const allValues = Object.values(locationsData).map(data => {
            const dayData = data[selectedDayIndex];
            return parseFloat(dayData[selectedAttribute]) || 0;
        });
        const minVal = Math.min(...allValues);
        const maxVal = Math.max(...allValues);

        // Crear marcadores para cada ubicación
        for (const [id, location] of Object.entries(appState.locations)) {
            const locationData = locationsData[id];
            const dayData = locationData[selectedDayIndex];
            const value = parseFloat(dayData[selectedAttribute]) || 0;
            
            const colorScale = attributeColors[selectedAttribute];
            const colorIndex = Math.floor(((value - minVal) / (maxVal - minVal)) * (colorScale.length - 1)) || 0;
            const color = colorScale[Math.min(colorIndex, colorScale.length - 1)];
            
            const marker = L.marker([location.lat, location.lon], {
                icon: getColoredMarkerIcon(color)
            }).addTo(appState.weatherMap);
            
            marker.bindPopup(`
                <b>${location.name}</b><br>
                <small>${dayData.Fecha}</small>
                <table class="table table-sm mt-2">
                    <tr><td><i class="wi wi-thermometer"></i> Temp Máx:</td><td>${dayData.TMax}°C</td></tr>
                    <tr><td><i class="wi wi-thermometer-exterior"></i> Temp Mín:</td><td>${dayData.TMin}°C</td></tr>
                    <tr><td><i class="wi wi-rain"></i> Lluvia:</td><td>${dayData.P_Lluvia}% (${dayData.mm}mm)</td></tr>
                    <tr><td><i class="wi wi-windy"></i> Viento:</td><td>${dayData.VientoMax} km/h</td></tr>
                    <tr><td><i class="wi wi-strong-wind"></i> Ráfagas:</td><td>${dayData.Rafagas} km/h</td></tr>
                </table>
            `);
            
            weatherMarkers.push(marker);
        }
        
        updateMapLegend(selectedAttribute, minVal, maxVal);
    } catch (error) {
        console.error("Error updating map markers:", error);
        L.control.alert("Error al cargar datos del mapa", {position: 'topright'}).addTo(appState.weatherMap);
    } finally {
        appState.weatherMap.removeControl(loadingControl);
    }
}

function processWeatherData(weatherData) {
    return weatherData.daily.time.map((date, i) => ({
        Fecha: new Date(date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
        TMax: weatherData.daily.temperature_2m_max[i]?.toFixed(1) || 'N/A',
        TMin: weatherData.daily.temperature_2m_min[i]?.toFixed(1) || 'N/A',
        P_Lluvia: weatherData.daily.precipitation_probability_max[i] || '0',
        mm: weatherData.daily.precipitation_sum[i]?.toFixed(1) || '0',
        VientoMax: weatherData.daily.windspeed_10m_max[i]?.toFixed(1) || '0',
        Rafagas: weatherData.daily.windgusts_10m_max[i]?.toFixed(1) || '0',
        DireccionViento: convertWindDirection(weatherData.daily.winddirection_10m_dominant[i])
    }));
}

function updateMapLegend(attribute, minVal, maxVal) {
    const legend = document.getElementById('mapLegend');
    const colorScale = attributeColors[attribute];
    const attributeNames = {
        TMax: 'Temperatura Máx (°C)',
        TMin: 'Temperatura Mín (°C)',
        P_Lluvia: 'Lluvia (%)',
        mm: 'Precipitación (mm)',
        VientoMax: 'Viento (km/h)',
        Rafagas: 'Ráfagas (km/h)'
    };
    
    legend.innerHTML = `
        <h6 class="mb-2">${attributeNames[attribute]}</h6>
        <div class="d-flex align-items-center mb-1">
            <small>${minVal.toFixed(1)}</small>
            <div class="flex-grow-1 mx-2" style="height: 20px; background: linear-gradient(to right, ${colorScale.join(',')})"></div>
            <small>${maxVal.toFixed(1)}</small>
        </div>
    `;
}

function getColoredMarkerIcon(color) {
    return L.divIcon({
        html: `<svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                  <path fill="${color}" d="M16 0a11 11 0 0 0-11 11c0 9 11 21 11 21s11-12 11-21a11 11 0 0 0-11-11z"/>
                  <circle fill="white" cx="16" cy="11" r="5"/>
              </svg>`,
        className: 'leaflet-custom-marker',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
    });
}

// Funciones de ayuda
function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    
    document.getElementById('currentDateTime').textContent = 
        now.toLocaleDateString('es-ES', options);

    // Actualizar cada segundo (1000ms) para un efecto de reloj en vivo
    setTimeout(updateDateTime, 1000);
}

// Inicializar de inmediato cuando se carga la página
document.addEventListener('DOMContentLoaded', function() {
    updateDateTime(); // Iniciar el reloj en vivo
});

function updateLocationDropdowns() {
    const dropdowns = ['locationSelect', 'graphLocationSelect', 'statsLocationSelect', 'reportLocation'];
    dropdowns.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = '';
        Object.entries(appState.locations).forEach(([locId, loc]) => {
            const option = document.createElement('option');
            option.value = locId;
            option.textContent = loc.name;
            select.appendChild(option);
        });
    });

    // Tabla de comparación (multi/tabla)
    const comparisonSelect = document.getElementById('comparisonLocations');
    if (comparisonSelect) {
        comparisonSelect.innerHTML = '';
        Object.entries(appState.locations).forEach(([locId, loc]) => {
            const option = document.createElement('option');
            option.value = locId;
            option.textContent = loc.name;
            comparisonSelect.appendChild(option);
        });
    }
}

// Pestañas de comparación logica
document.addEventListener('DOMContentLoaded', () => {
    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) {
        compareBtn.addEventListener('click', async () => {
            const select = document.getElementById('comparisonLocations');
            const selected = Array.from(select.selectedOptions).map(opt => opt.value);
            const attrs = [];
            if (document.getElementById('compAttr1').checked) attrs.push('TMax');
            if (document.getElementById('compAttr2').checked) attrs.push('TMin');
            if (document.getElementById('compAttr3').checked) attrs.push('P_Lluvia');
            if (document.getElementById('compAttr4').checked) attrs.push('mm');
            if (document.getElementById('compAttr5').checked) attrs.push('VientoMax');
            if (document.getElementById('compAttr6').checked) attrs.push('Rafagas');
            if (selected.length < 2 || attrs.length === 0) {
                document.getElementById('comparisonContent').innerHTML = '<div class="alert alert-warning">Seleccione al menos dos ubicaciones y un atributo.</div>';
                return;
            }
            let allData = {};
            for (const locId of selected) {
                await loadTableData(locId);
                allData[locId] = { name: appState.locations[locId].name, data: appState.currentData };
            }
            let html = '<div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Fecha</th>';
            selected.forEach(locId => {
                attrs.forEach(attr => html += `<th>${allData[locId].name} - ${attr}</th>`);
            });
            html += '</tr></thead><tbody>';
            const dates = allData[selected[0]].data.map(d => d.Fecha);
            dates.forEach((date, i) => {
                html += `<tr><td>${date}</td>`;
                selected.forEach(locId => {
                    attrs.forEach(attr => {
                        const d = allData[locId].data[i];
                        html += `<td>${d[attr]}</td>`;
                    });
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
            document.getElementById('comparisonContent').innerHTML = html;
        });
    }

    // Graficas de comparación
    const compareGraphBtn = document.getElementById('compareGraphBtn');
    if (compareGraphBtn) {
        compareGraphBtn.addEventListener('click', async () => {
            const select = document.getElementById('comparisonLocations');
            const selected = Array.from(select.selectedOptions).map(opt => opt.value);
            const attr = document.getElementById('comparisonGraphAttr').value;
            if (selected.length < 2 || !attr) {
                document.getElementById('comparisonChart').innerHTML = '<div class="alert alert-warning">Seleccione al menos dos ubicaciones y un atributo para la gráfica.</div>';
                return;
            }
            let allData = {};
            for (const locId of selected) {
                await loadTableData(locId);
                allData[locId] = { name: appState.locations[locId].name, data: appState.currentData };
            }
            // Crear trazas para la gráfica
            const traces = selected.map(locId => ({
                x: allData[locId].data.map(d => d.Fecha),
                y: allData[locId].data.map(d => parseFloat(d[attr])),
                name: allData[locId].name,
                type: 'lines+markers'
            }));
            const nameMap = {
                'TMax': 'Temperatura Máxima (°C)',
                'TMin': 'Temperatura Mínima (°C)',
                'P_Lluvia': 'Probabilidad de Lluvia (%)',
                'mm': 'Precipitación (mm)',
                'VientoMax': 'Viento (km/h)',
                'Rafagas': 'Ráfagas (km/h)'
            };
            const layout = {
                title: `Comparativa de ${nameMap[attr]}`,
                xaxis: { title: 'Fecha', tickangle: -45, type: 'category' },
                yaxis: { title: nameMap[attr] },
                legend: { orientation: 'h', y: -0.3 },
                margin: { t: 50, b: 100, l: 50, r: 50 },
                hovermode: 'x unified'
            };
            Plotly.newPlot('comparisonChart', traces, layout);
        });
    }
});


if (document.readyState === 'complete') {
    initApp();
} else {
    document.addEventListener('DOMContentLoaded', initApp);
}