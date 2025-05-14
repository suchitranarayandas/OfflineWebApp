from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
import sqlite3
import uuid
import qrcode
from io import BytesIO
from pyzbar.pyzbar import decode
import requests
from PIL import Image
import cv2
import numpy as np

app = Flask(__name__, static_folder='static', template_folder='templates',static_url_path='/static')
CORS(app)

# SQLite setup
conn = sqlite3.connect("form_data.db", check_same_thread=False)
c = conn.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS form_data (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    phone TEXT,
    account_type TEXT
)''')
conn.commit()

@app.route('/')
def home():
    return render_template('landing.html')

@app.route('/sw.js')
def service_worker():
    return send_file('sw.js', mimetype='application/javascript')

@app.route('/form')
def form_page():
    return render_template('index.html')

@app.route('/upload_qr', methods=['GET'])
def upload_qr_page():
    return render_template('upload_qr.html')


@app.route('/upload_qr', methods=['POST'])
def upload_qr():
    print("Upload QR route hit")
    if 'file' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    image_file = request.files['file']
    image = Image.open(image_file.stream).convert('RGB')

    # Convert PIL image to OpenCV format
    image_np = np.array(image)
    image_cv = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

    # Detect and decode QR
    detector = cv2.QRCodeDetector()
    data, bbox, _ = detector.detectAndDecode(image_cv)

    if not data:
        return jsonify({'error': 'QR code not recognized'}), 400

    form_id = data.strip()
    print("after decoding the qr")
    print(form_id)
    # Lookup form data in the database
    c.execute("SELECT id, name, email, phone, account_type FROM form_data WHERE id = ?", (form_id,))
    row = c.fetchone()
    print("unwrapped qr code")
    print(row)

    if not row:
        return jsonify({'error': 'No form data found for the QR ID'}), 404

    form_data = {
        "Name": row[1],
        "Email_Address__c": row[2],
        "Phone__c": row[3],
        "Type__c": row[4]
    }

    salesforce_result = push_to_salesforce(form_data)
    print("data")
    print(form_data)
    print("salesforce_result")
    print(salesforce_result)
    if len(salesforce_result['errors']) == 0:
        return jsonify('Data Uploaded to Salesforce Successfully')
    else:
        return jsonify({"error"}), 500

@app.route('/submit', methods=['POST'])
def submit_form():
    data = request.get_json()
    print("Received data:", data)
    form_id = data.get("id")
    name = data.get("name")
    email = data.get("email")
    phone = data.get("phone")
    account_type = data.get("accountType")
    print(form_id, name, email,phone, account_type)
    try:
        c.execute("INSERT OR IGNORE INTO form_data (id, name, email, phone, account_type) VALUES (?, ?, ?, ?, ?)",
                  (form_id, name, email, phone, account_type))
        conn.commit()
        return jsonify({
            "status": "received",
            "id": form_id,
            "name": name,
            "email": email,
            "phone": phone,
            "accountType": account_type
        })
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500

@app.route('/generate_qr', methods=['POST'])
def generate_qr():
    try:
        data = request.get_json()
        form_id = data.get("id")
        print("Generating QR for form ID:", form_id)

        # Lookup full data in the database
        c.execute("SELECT id, name, email, phone, account_type FROM form_data WHERE id=?", (form_id,))
        row = c.fetchone()

        if not row:
            return jsonify({"error": "No form data found for the given ID"}), 404

        # Convert row into a dict
        user_data = {
            "id": row[0],
            "name": row[1],
            "email": row[2],
            "phone": row[3],
            "accountType": row[4]
        }

        print("Encoding data into QR:", user_data)
        json_data = json.dumps(user_data)
        qr = qrcode.make(json_data)

        buffer = BytesIO()
        qr.save(buffer, format="PNG")
        buffer.seek(0)

        return send_file(buffer, mimetype='image/png', as_attachment=True, download_name='user_data_qr.png')
    
    except Exception as e:
        print("QR Generation error:", e)
        return jsonify({"error": str(e)}), 500



@app.route('/process_qr', methods=['POST'])
def process_qr():
    if 'qr_image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    image_file = request.files['qr_image']
    image = Image.open(image_file.stream).convert('RGB')

    # Convert PIL image to OpenCV format
    image_np = np.array(image)
    image_cv = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

    # Detect and decode QR
    detector = cv2.QRCodeDetector()
    data, bbox, _ = detector.detectAndDecode(image_cv)

    if not data:
        return jsonify({'error': 'QR code not recognized'}), 400

    form_id = data.strip()
    print("after decoding the qr")
    print(form_id)
    # Lookup form data in the database
    c.execute("SELECT id, name, email, phone, account_type FROM form_data WHERE id = ?", (form_id,))
    row = c.fetchone()
    print("unwrapped qr code")
    print(row)

    if not row:
        return jsonify({'error': 'No form data found for the QR ID'}), 404

    form_data = {
        "Name": row[1],
        "Email_Address__c": row[2],
        "Phone__c": row[3],
        "Type__c": row[4]
    }

    salesforce_result = push_to_salesforce(form_data)
    return jsonify({"status": "success", "data": form_data, "salesforce_result": salesforce_result})

    # return jsonify({"status": "success", "data": form_data})
    return jsonify({"status": "success"})


@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/routes')
def show_routes():
    return '<br>'.join(str(rule) for rule in app.url_map.iter_rules())

def push_to_salesforce(data):
    try:
        custom_object_api = 'User_Application_form_ABSA__c'
        auth_url = r'https://login.salesforce.com/services/oauth2/token'
        SF_USERNAME = 'susmita.roy@agentforce.io'
        # SF_SECURITY_TOKEN = 'gFw2QgN7IkKWpAHcWmGIGXyy'
        SF_PASSWORD = 'Susmita@1235H9wGHd8mjJUX3CPVKRDmTKr1'
        # # SF_DOMAIN = 'login'  # Or 'test' for sandbox
        CLIENT_ID = '3MVG95nWQGdmAiEot5YnhY2v.Sg4jhXW4oqtz59iWzwwzWWjRA7pUZjh6a1duIJAvEP94Rktm1Z3zVVvVRN5i'
        CLIENT_SECRET = '9911B833FD0C74E17A0F6EE232EBED715DB6324085CBFBA86CC476B25981E347'
        # client_id = '3MVG9PwZx9R6_UreBEGBdFTO5phipzeaL23EuI.so3TmK76DWT9D3o9MXZhYdPKyernDcy6NMpYvqsnt_h.TR'  # Also called consumer key
        # client_secret = '05317A60D5E6B2DD84764C0778EBC4A8E79EEF60F7F981040BB9837B34C44F3F'
        # username = 'harshithaponnapalli20@curious-impala-ltw5ji.com'
        # password = 'Qwerty@12345' + 'U9gBSRgYCcvX1WFCg8cawfJK'
        payload = {
            'grant_type': 'password',
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'username': SF_USERNAME,
            'password': SF_PASSWORD
        }
        print(auth_url)
        print(payload)
        try:
            response = requests.post(auth_url, data=payload)
            response_data = response.json()
            print("response data")
            print(response_data)
            instance_url = response_data['instance_url']
            print("instance url data")
            print(instance_url)
            access_token = response_data['access_token']
        except Exception as e:
            response_data = None
            print("Salesforce error:", e)
        # response = sf.Custom_Object__c.create({  # Replace with your actual object API name
        #     'Name': data['name'],
        #     'Email__c': data['email'],
        #     'Phone__c': data['phone'],
        #     'Account_Type__c': data['account_type'],
        #     'External_Id__c': data['id']  # Optional: if using external ID
        # })

        url = f'{instance_url}/services/data/v60.0/sobjects/{custom_object_api}/'
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }

        response = requests.post(url, json=data, headers=headers)

        if response.status_code == 201:
            print('Record created successfully!')
            return response.json()  # Contains "id", "success", etc.
        else:
            print(f'Failed to create record: {response.status_code} - {response.text}')
            return response.json()
        print("object url")
        print(url)
        return response_data
    except Exception as e:
        return {'error': str(e)}


if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
