#!/bin/bash
# setup-autostart.sh
# 
# Creates a systemd service to auto-start Supabase containers on VM boot.
# This is required for VMs with auto-shutdown/startup schedules (e.g., Azure).
#
# Usage: ./setup-autostart.sh [working_directory]
#   working_directory: Optional. Defaults to the script's directory.
#
# Example:
#   ./setup-autostart.sh
#   ./setup-autostart.sh /path/to/supabase-docker

set -e

# Determine working directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKING_DIR="${1:-$SCRIPT_DIR}"

# Get the user running the script (even if run with sudo)
CURRENT_USER="${SUDO_USER:-$USER}"

echo "=== Supabase Auto-Start Service Setup ==="
echo "Working directory: $WORKING_DIR"
echo "User: $CURRENT_USER"
echo ""

# Verify docker-compose.yml exists
if [ ! -f "$WORKING_DIR/docker-compose.yml" ]; then
    echo "Error: docker-compose.yml not found in $WORKING_DIR"
    exit 1
fi

# Create systemd service file
echo "Creating systemd service..."
sudo tee /etc/systemd/system/supabase.service > /dev/null << EOF
[Unit]
Description=Supabase Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$WORKING_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=$CURRENT_USER
Group=docker

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "Enabling supabase service..."
sudo systemctl enable supabase.service

echo "Starting supabase service..."
sudo systemctl start supabase.service

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Supabase will now auto-start when the VM boots."
echo ""
echo "Useful commands:"
echo "  sudo systemctl status supabase.service   # Check status"
echo "  sudo systemctl restart supabase.service  # Restart"
echo "  sudo systemctl stop supabase.service     # Stop"
echo "  sudo journalctl -u supabase.service      # View logs"
echo ""

# Show current status
sudo systemctl status supabase.service --no-pager
