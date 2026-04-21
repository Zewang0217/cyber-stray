"""
测试文件 - 故意包含一些代码问题，用于测试 AI Review Bot
"""


# 问题1: 魔法数字
def calculate_price(amount):
    if amount > 100:
        return amount * 1.2  # 魔法数字 1.2
    return amount


# 问题2: 深层嵌套 (超过3层)
def process_data(data):
    if data:
        if data.get('items'):
            if data['items'].get('values'):
                if data['items']['values'].get('active'):
                    for item in data['items']['values']['active']:
                        if item:
                            if item.get('id'):
                                print(item['id'])  # 深层嵌套 + print调试代码


# 问题3: 函数过长 (超过50行)
def long_function(x):
    # 这是一个故意写得很长的函数
    result = 0
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    result += x
    return result


# 问题4: 无意义命名
def process(a, b, c):
    # a, b, c 无意义
    d = a + b
    e = d * c
    return e


# 问题5: 注释掉的代码
def new_function():
    # 旧代码应该删除，不要注释掉
    # old_result = get_old_data()
    # old_result.process()
    # return old_result
    return "new value"