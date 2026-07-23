#!/data/data/com.termux/files/usr/bin/python
"""
Flask API server to expose brain features to the APK.
"""
import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from chatgpt_brain import ChatGPTBrain
from brain_analyzer import BrainAnalyzer

app = Flask(__name__)
CORS(app)

chat_brain = ChatGPTBrain()
brain_analyzer = BrainAnalyzer()

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    prompt = data.get('prompt', '')
    system = data.get('system', 'You are VOID AI, a helpful assistant.')
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400
    response = chat_brain.ask(prompt, system)
    return jsonify({"response": response})

@app.route('/api/brain/scan', methods=['GET'])
def scan():
    results = brain_analyzer.scan()
    return jsonify(results)

@app.route('/api/brain/summary/<dataset_id>', methods=['GET'])
def summary(dataset_id):
    summary = brain_analyzer.get_brain_summary(dataset_id)
    return jsonify(summary)

@app.route('/api/brain/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files['file']
    filename = file.filename
    file.save(filename)
    analysis = brain_analyzer.analyze_graph(filename)
    os.remove(filename)
    return jsonify(analysis)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
