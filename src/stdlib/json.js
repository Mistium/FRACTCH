export const JSON_SOURCE = String.raw`
def @fractch_json_get_data(JSON) warp {
  lists["!json:stack"].clear();
  local isArray = letter(1, JSON) == "[" && letter(length(JSON), JSON) == "]";
  if isArray == "true" || letter(1, JSON) == "{" && letter(length(JSON), JSON) == "}" {
    local depth = 0;
    local quotes = 0;
    local stack = "";
    local i = 1;
    local temp = 0;
    local cur = "";
    local cur2 = "";
    repeat length(JSON) - 2 {
      temp = 0;
      i += 1;
      cur = letter(i, JSON);
      if cur == "\\" {
        i += 1;
        stack = stack ++ ("\\" ++ letter(i, JSON));
      } else {
        if cur == "\"" && depth == 0 {
          quotes = 1 - quotes;
        }
        if quotes == 0 {
          depth += (cur == "{") - (cur == "}") + ((cur == "[") - (cur == "]"));
          if depth == 0 && cur == "," {
            if isArray == "true" {
              lists["!json:stack"].add(lists["!json:stack"].length / 2);
            }
            lists["!json:stack"].add(stack);
            stack = "";
            temp = 1;
          }
        }
        if depth > -1 && (temp == 0 && !(cur == " " && !(depth > 0 || quotes > 0))) {
          stack = stack ++ cur;
        }
      }
    }
    if length(stack) > 0 {
      if isArray == "true" {
        lists["!json:stack"].add(lists["!json:stack"].length / 2);
      }
      lists["!json:stack"].add(stack);
    }
    if lists["!json:stack"].length > 0 && isArray == "false" {
      i = 0;
      repeat lists["!json:stack"].length {
        i += 1;
        depth = 0;
        quotes = 0;
        stack = "";
        cur2 = lists["!json:stack"][i];
        temp = 0;
        repeat length(cur2) {
          temp += 1;
          cur = letter(temp, cur2);
          if i % 2 == 0 {
            stack = stack ++ cur;
            lists["!json:stack"].replace(i, stack);
          } else if cur == "\\" {
            temp += 1;
            stack = stack ++ ("\\" ++ letter(temp, cur2));
          } else {
            if cur == "\"" && depth == 0 {
              quotes = 1 - quotes;
            } else if !(cur == ":" && depth == 0) {
              stack = stack ++ cur;
            }
            if quotes == 0 {
              depth += (cur == "{") - (cur == "}") + ((cur == "[") - (cur == "]"));
              if depth == 0 && cur == ":" {
                lists["!json:stack"].insert(i, stack);
                i += 1;
                stack = "";
              }
            }
          }
        }
      }
    }
  }
}

def @fractch_json_return(value) warp {
  lists["!json:stack"].clear();
  lists["!json:stack"].add(value);
}

def @fractch_json_construct() warp {
  local isArray = "true";
  local i = -1;
  repeat lists["!json:stack"].length / 2 {
    i += 2;
    if lists["!json:stack"][i] / 1 != lists["!json:stack"][i] {
      isArray = "false";
    }
  }
  local stack = "";
  if isArray == "true" {
    stack = "[";
    repeat lists["!json:stack"].length / 2 {
      stack = stack ++ lists["!json:stack"][2];
      if lists["!json:stack"].length > 2 {
        stack = stack ++ ",";
      }
      lists["!json:stack"].delete(1);
      lists["!json:stack"].delete(1);
    }
    vars["!json:return"] = stack ++ "]";
  } else {
    stack = "{";
    repeat lists["!json:stack"].length / 2 {
      stack = stack ++ ("\"" ++ (lists["!json:stack"][1] ++ "\": "));
      stack = stack ++ lists["!json:stack"][2];
      if lists["!json:stack"].length > 2 {
        stack = stack ++ ",";
      }
      lists["!json:stack"].delete(1);
      lists["!json:stack"].delete(1);
    }
    vars["!json:return"] = stack ++ "}";
  }
  return vars["!json:return"];
}

def @fractch_json_get_values(JSON) warp {
  @fractch_json_get_data(JSON);
  local i = 0;
  repeat lists["!json:stack"].length / 2 {
    i += 1;
    lists["!json:stack"].delete(i);
  }
}

def @fractch_json_get_keys(JSON) warp {
  @fractch_json_get_data(JSON);
  local i = 1;
  repeat lists["!json:stack"].length / 2 {
    i += 1;
    lists["!json:stack"].delete(i);
  }
}

def @fractch_json_get_from(Key, JSON) warp {
  @fractch_json_get_data(JSON);
  local i = 0;
  until i > lists["!json:stack"].length / 2 || lists["!json:stack"][i] == Key {
    i += 1;
  }
  vars["!json:return"] = lists["!json:stack"][i + 1];
  if letter(1, vars["!json:return"]) ++ letter(length(vars["!json:return"]), vars["!json:return"]) == "\"\"" {
    @fractch_json_slice(vars["!json:return"], 2, -2);
  }
  return vars["!json:return"];
}

def @fractch_json_set(Key, Value, JSON) warp {
  local setval = Value;
  @fractch_json_valid(setval);
  if lists["!json:stack"][1] == "false" && Value / 1 != Value {
    @fractch_json_replace("\\", setval, "\\\\");
    @fractch_json_replace("\"", vars["!json:return"], "\\\"");
    setval = "\"" ++ (vars["!json:return"] ++ "\"");
  }
  @fractch_json_get_keys(JSON);
  local idx = lists["!json:stack"].indexof(Key);
  lists["!json:stack"].clear();
  @fractch_json_get_data(JSON);
  if idx > 0 {
    lists["!json:stack"].replace(idx * 2, setval);
  } else {
    lists["!json:stack"].add(Key);
    lists["!json:stack"].add(setval);
  }
  return @fractch_json_construct();
}

def @fractch_json_valid(JSON) warp {
  @fractch_json_get_data(JSON);
  @fractch_json_return(lists["!json:stack"].length > 0 || (JSON == {} || JSON == []));
  return lists["!json:stack"][1];
}

def @fractch_json_has(Key, JSON) warp {
  @fractch_json_get_keys(JSON);
  @fractch_json_return(lists["!json:stack"].contains(Key));
  return lists["!json:stack"][1];
}

def @fractch_json_replace(value, text, newval) warp {
  vars["!json:return"] = "";
  local idx = length(value);
  local i = length(text);
  local i2 = 0;
  until i < 1 {
    if idx == 0 {
      vars["!json:return"] = newval ++ (letter(i, text) ++ vars["!json:return"]);
      i += -1;
    } else {
      i2 = 0;
      until letter(idx - i2, value) != letter(i, text) || i < 1 {
        i += -1;
        i2 += 1;
      }
      if i2 == idx {
        vars["!json:return"] = newval ++ vars["!json:return"];
      } else {
        i += i2;
        repeat i2 + 1 {
          vars["!json:return"] = letter(i, text) ++ vars["!json:return"];
          i += -1;
        }
      }
    }
  }
  return vars["!json:return"];
}

def @fractch_json_slice(string, start, end) warp {
  vars["!json:return"] = "";
  local i2 = end;
  if i2 < 0 {
    i2 += length(string) + 1;
  }
  local i = start;
  repeat i2 - (i - 1) {
    vars["!json:return"] = vars["!json:return"] ++ letter(i, string);
    i += 1;
  }
  return vars["!json:return"];
}
`;
