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

# Command to run the application
CMD ["node", "index-supabase-fixed.js"]
