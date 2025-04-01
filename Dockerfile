FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose the port the app runs on
ENV PORT=8080
EXPOSE 8080

# Add startup script to handle potential errors
RUN echo '#!/bin/bash\necho "Starting application..."\nnode index-supabase-fixed.js 2>&1 | tee /app/server.log' > /app/start.sh && \
    chmod +x /app/start.sh

# Command to run the application
CMD ["/app/start.sh"]
