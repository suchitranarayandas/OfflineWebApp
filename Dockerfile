# Use an official lightweight Python image
FROM python:3.10-slim

# Install zbar and other system dependencies
RUN apt-get update && \
    apt-get install -y libzbar0 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy app code
COPY . .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Set environment variables
ENV PORT=8000

# Start the app with gunicorn
CMD gunicorn app:app --bind 0.0.0.0:$PORT
