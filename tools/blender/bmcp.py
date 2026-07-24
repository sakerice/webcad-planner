#!/usr/bin/env python3
"""Minimal client for the blender-mcp addon socket (same protocol as blenderMCP)."""
import json, socket, sys

def send(cmd_type, params, timeout=120):
    s = socket.create_connection(('localhost', 9876), timeout=timeout)
    s.sendall(json.dumps({'type': cmd_type, 'params': params}).encode())
    chunks = []
    s.settimeout(timeout)
    while True:
        try:
            data = s.recv(65536)
        except socket.timeout:
            break
        if not data:
            break
        chunks.append(data)
        try:
            json.loads(b''.join(chunks).decode())
            break
        except json.JSONDecodeError:
            continue
    s.close()
    return json.loads(b''.join(chunks).decode())

if __name__ == '__main__':
    if sys.argv[1] == 'code':
        code = open(sys.argv[2]).read() if len(sys.argv) > 2 else sys.stdin.read()
        r = send('execute_code', {'code': code})
    else:
        r = send(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    print(json.dumps(r, ensure_ascii=False, indent=1)[:4000])
