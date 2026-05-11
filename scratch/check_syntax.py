import sys

def check_html_js(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    start_tag = '<script>'
    end_tag = '</script>'
    
    start_idx = content.find(start_tag)
    while start_idx != -1:
        end_idx = content.find(end_tag, start_idx)
        if end_idx == -1:
            print("Unclosed script tag")
            return
        
        js_code = content[start_idx + len(start_tag) : end_idx]
        # We can't easily check syntax with node here since it's mixed, 
        # but we can try to save it to a temp file and run node --check.
        with open('temp.js', 'w', encoding='utf-8') as tf:
            tf.write(js_code)
        
        import subprocess
        result = subprocess.run(['node', '--check', 'temp.js'], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"JS Error in script block starting at {start_idx}:")
            print(result.stderr)
        else:
            print("JS Syntax OK")
        
        start_idx = content.find(start_tag, end_idx)

if __name__ == "__main__":
    check_html_js(sys.argv[1])
