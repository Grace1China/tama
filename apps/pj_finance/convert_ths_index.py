#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
转换 ths_index_copy.json 为 Parquet 文件（ths_index.parquet）
"""
import json
import os
import sys

# 定义可能的输入和输出路径
INPUT_PATHS = [
    'temp/tuShare/ths_index/ths_index_copy.json',
    './temp/tuShare/ths_index/ths_index_copy.json',
    os.path.join(os.path.dirname(__file__), 'temp/tuShare/ths_index/ths_index_copy.json'),
    '/Users/daniel/.cursor/worktrees/___/hoj/temp/tuShare/ths_index/ths_index_copy.json',
]

OUTPUT_PATH = 'temp/tuShare/ths_index.parquet'

def find_file():
    """查找JSON文件"""
    for path in INPUT_PATHS:
        abs_path = os.path.abspath(path)
        if os.path.exists(abs_path):
            return abs_path
        if os.path.exists(path):
            return os.path.abspath(path)
    return None

def convert():
    """执行转换"""
    json_path = find_file()
    
    if json_path is None:
        print("未找到 ths_index_copy.json 文件")
        print("尝试过的路径:")
        for path in INPUT_PATHS:
            print(f"  - {path}")
        print("\n请确保文件存在于以下位置之一，或手动指定路径:")
        print("  python3 convert_ths_index.py <文件路径>")
        return False
    
    parquet_path = os.path.join(os.path.dirname(os.path.dirname(json_path)), 'ths_index.parquet')
    
    print(f"找到文件: {json_path}")
    print(f"读取JSON文件...")
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"读取文件失败: {e}")
        return False
    
    if not isinstance(data, list):
        print(f"错误: JSON文件应该包含一个数组，但得到的是 {type(data).__name__}")
        return False
    
    if len(data) == 0:
        print("警告: 数组为空，未生成 parquet")
        return False
    
    # 收集所有keys（处理不同对象可能有不同keys的情况）
    all_keys = set()
    for item in data:
        if isinstance(item, dict):
            all_keys.update(item.keys())
    
    keys = sorted(list(all_keys))
    print(f"发现 {len(keys)} 列, 总行数: {len(data)}")
    os.makedirs(os.path.dirname(parquet_path), exist_ok=True)
    print(f"写入 Parquet 文件: {parquet_path}")
    try:
        try:
            import pandas as pd
        except Exception as e:
            print(f"缺少 pandas 依赖，无法写 parquet: {e}")
            print("请先安装: pip install pandas pyarrow")
            return False

        rows = []
        for item in data:
            if isinstance(item, dict):
                rows.append({key: item.get(key, None) for key in keys})

        df = pd.DataFrame(rows, columns=keys)
        df.to_parquet(parquet_path, index=False)
        print(f"成功! Parquet 文件已创建: {parquet_path}")
        return True
    except Exception as e:
        print(f"写入文件失败: {e}")
        return False

if __name__ == '__main__':
    # 如果提供了命令行参数，使用该路径
    if len(sys.argv) > 1:
        json_path = sys.argv[1]
        if not os.path.exists(json_path):
            print(f"文件不存在: {json_path}")
            sys.exit(1)
        
        parquet_path = (
            sys.argv[2]
            if len(sys.argv) > 2
            else os.path.join(os.path.dirname(os.path.dirname(json_path)), 'ths_index.parquet')
        )
        
        # 直接转换
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if not isinstance(data, list):
            print("错误: JSON文件应该包含一个数组")
            sys.exit(1)
        
        all_keys = set()
        for item in data:
            if isinstance(item, dict):
                all_keys.update(item.keys())
        keys = sorted(list(all_keys))
        rows = [{key: item.get(key, None) for key in keys} for item in data if isinstance(item, dict)]

        try:
            import pandas as pd
        except Exception as e:
            print(f"缺少 pandas 依赖，无法写 parquet: {e}")
            print("请先安装: pip install pandas pyarrow")
            sys.exit(1)

        os.makedirs(os.path.dirname(parquet_path), exist_ok=True)
        pd.DataFrame(rows, columns=keys).to_parquet(parquet_path, index=False)
        print(f"成功! Parquet 文件已创建: {parquet_path}")
    else:
        success = convert()
        sys.exit(0 if success else 1)
