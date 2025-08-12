import requests
from datetime import datetime

def fetch_meteo_data(lat, lon):
    """Fetch 14-day weather forecast from Open-Meteo API"""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": ["temperature_2m_max", "temperature_2m_min", 
                 "precipitation_sum", "precipitation_probability_max"],
        "timezone": "auto",
        "forecast_days": 14
    }
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"API Error: {e}")
        return None

def display_weather_data(data):
    """Display weather data in a table format"""
    if not data:
        print("No data received")
        return
    
    print(f"\nWeather Forecast for Guanajuato (21.0190°N, -101.2574°W)")
    print("=" * 70)
    print(f"{'Date':<15}{'Max Temp (°C)':<15}{'Min Temp (°C)':<15}{'Rain (%)':<10}{'Precip (mm)':<10}")
    print("-" * 70)
    
    for i in range(len(data["daily"]["time"])):
        date = datetime.strptime(data["daily"]["time"][i], "%Y-%m-%d").strftime("%a %d %b")
        tmax = data["daily"]["temperature_2m_max"][i]
        tmin = data["daily"]["temperature_2m_min"][i]
        rain_prob = data["daily"]["precipitation_probability_max"][i]
        precip = data["daily"]["precipitation_sum"][i]
        
        print(f"{date:<15}{tmax:<15.1f}{tmin:<15.1f}{rain_prob:<10}{precip:<10.1f}")

# Guanajuato coordinates
LAT = 21.0190
LON = -101.2574

LAT2 = 25.6866	
LON2 = -100.3161


# Fetch and display data
weather_data = fetch_meteo_data(LAT2, LON2)
display_weather_data(weather_data)