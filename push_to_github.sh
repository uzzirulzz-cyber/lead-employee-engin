#!/bin/bash
# Lead Employee Engine - Push to GitHub
# Repo: https://github.com/uzzirulzz-cyber/lead-employee-engin
echo "=== Lead Employee Engine v3 - GitHub Push ==="
echo "Repo: https://github.com/uzzirulzz-cyber/lead-employee-engin"
echo "Super Admin: admin@playbeat.live / playbeat1122"
echo "Neon DB: Connected"
git init
git add .
git commit -m "Lead Employee Engine v3 - Super Admin admin@playbeat.live / playbeat1122 + 4 seats 250 each + router + calling + landing + Neon DB" || echo "Commit exists"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/uzzirulzz-cyber/lead-employee-engin.git
echo "Pushing to https://github.com/uzzirulzz-cyber/lead-employee-engin.git ..."
git push -u origin main --force
echo "Done! Repo: https://github.com/uzzirulzz-cyber/lead-employee-engin"
