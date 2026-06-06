#!/bin/zsh

export PATH=/opt/homebrew/bin:$PATH

while true
do
  echo "Starting OpenClaw (global install, gateway run)..."
  /opt/homebrew/bin/openclaw gateway run

  echo "OpenClaw gateway exited. Restarting in 5 seconds..."
  sleep 5
done
