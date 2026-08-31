#!/usr/bin/env bash
# Gate #369 chặng (c) — Go + FE. Ghi exit code thật từng bước.
set -u
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24 || exit 1
mkdir -p logs
cd apps/web-api || exit 1
go vet ./... > ../../logs/gate369-govet.log 2>&1
echo "$?" > ../../logs/gate369-govet.exit
go test ./... -count=1 > ../../logs/gate369-gotest.log 2>&1
echo "$?" > ../../logs/gate369-gotest.exit
cd ../..
echo "govet=$(cat logs/gate369-govet.exit) gotest=$(cat logs/gate369-gotest.exit)"
