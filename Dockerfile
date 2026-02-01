# Use Deno official image
FROM denoland/deno:2.1.4

# Set working directory
WORKDIR /app

# Copy all files
COPY . .

# Cache dependencies (optional but recommended)
RUN deno cache api/main.ts

# Expose port
EXPOSE 8000

# Run the app
CMD ["deno", "run", "--allow-all", "api/main.ts"]
