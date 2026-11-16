#!/bin/bash
# Double-click to install. Same as running `bash install.sh` in this folder.
# If macOS says it "cannot be opened because it is from an unidentified developer": right-click the file, choose Open,
# then Open again. Or open Terminal and run:  bash install.sh   (see INSTALL.txt).
cd "$(dirname "$0")" || exit 1
/bin/bash ./install.sh
echo ""
read -r -p "Press Enter to close this window."
