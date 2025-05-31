import requests
import math

def test_navmesh_coord(coords):
    print(f"\nTesting with input coordinates: {coords}")
    
    # Transform Z before sending (as per original code)
    coords['z'] = -abs(coords['z']) if coords['z'] > 0 else abs(coords['z'])
    print(f"Transformed coordinates for request: {coords}")

    url = "https://dsc.dev.aukiverse.com/spatial/restricttonavmesh"
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
    body = {
        'domainId': 'test',  # You'll need to replace with actual domain ID
        'domainServerUrl': 'test',  # You'll need to replace with actual server URL
        'target': {
            'x': coords['x'],
            'y': 0,
            'z': coords['z']
        },
        'radius': 0.5
    }

    print(f"\nRequest body: {body}")
    response = requests.post(url, headers=headers, json=body)
    print(f"Response status: {response.status_code}")
    
    if response.status_code != 200:
        print(f"Error response: {response.text}")
        return None

    result = response.json()
    print(f"Raw response: {result}")

    # Extract coordinates and calculate as per Python example
    x1 = coords['x']
    z1 = coords['z']
    x2 = result['restricted']['x']
    z2 = result['restricted']['z']

    delta_x = x1 - x2
    delta_z = z1 - z2

    z2 = -abs(z2) if z2 > 0 else abs(z2)
    yaw = round(math.atan2(delta_z, delta_x), 2)
    yaw = -abs(yaw) if yaw > 0 else abs(yaw)

    final_result = {'x': x2, 'z': z2, 'yaw': yaw}
    print(f"\nCalculated result: {final_result}")
    return final_result

# Test with the example coordinates
test_coords = {'x': -6.77, 'y': 0, 'z': 0.60}
result = test_navmesh_coord(test_coords)

# Print intermediate values for debugging
if result:
    print("\nVerification:")
    print(f"Expected: x=-6.270300406695041, z=0.6000000413170843, yaw=-3.14")
    print(f"Got:      x={result['x']}, z={result['z']}, yaw={result['yaw']}") 