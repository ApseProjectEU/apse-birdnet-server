from flask import Flask, request, jsonify
from flask_cors import CORS
from birdnetlib import Recording
from birdnetlib.analyzer import Analyzer
import os

app = Flask(__name__)
CORS(app)

analyzer = Analyzer()

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    file = request.files['audio']
    filepath = "temp_audio.wav"
    file.save(filepath)

    try:
        recording = Recording(
            analyzer,
            filepath,
            min_confidence=0.25
        )
        recording.analyze()

        results = recording.detections
    finally:
        if os.path.exists(filepath):
            os.remove(filepath)

    return jsonify(results)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
