# Use Deno official image - v2.2+ for lockfile v5 support
FROM denoland/deno:2.2.0

# Install Node.js and npm for esbuild bundling
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install esbuild globally
RUN npm install -g esbuild

# Set working directory
WORKDIR /app

# Copy all files
COPY . .

# Cache Deno dependencies
RUN deno cache api/main.ts

# Expose port
EXPOSE 8000

# Run the app
CMD ["deno", "run", "--allow-all", "api/main.ts"]
