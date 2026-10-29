#!/usr/bin/env python3
"""Retired: cookie-authenticated lookup is not supported. Use the loopback provider adapter."""
import json
import sys
if __name__ == '__main__':
    print(json.dumps({'status': 'unavailable', 'reason': 'Use XOfficialProvider with an approved server-side API credential. Browser-session lookup was retired.'}))
    sys.exit(1)
