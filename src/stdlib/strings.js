export const STRINGS_SOURCE = String.raw`
def @fractch_strings_join(delim) warp {
  local out = "";
  local i = 0;
  repeat lists["!json:stack"].length {
    i += 1;
    if i > 1 {
      out = out ++ delim;
    }
    out = out ++ lists["!json:stack"][i];
  }
  return out;
}

def @fractch_strings_replace(text, old, new) warp {
  local ret = ""
  local idx = length(old)
  local i = length(text)
  local i2 = 0
  until i < 1 {
    if idx == 0 {
      ret = new ++ letter(i, text) ++ ret
      i -= 1
    } else {
      i2 = 0
      until letter(idx - i2, old) != letter(i, text) || i < 1 {
        i -= 1
        i2 += 1
      }
      if i2 == idx {
        ret = new ++ ret
      } else {
        i += i2
        repeat i2 + 1 {
          ret = letter(i, text) ++ ret
          i -= 1
        }
      }
    }
  }
  return ret
}

def @fractch_strings_chr(code) warp {
  if code == 10 {
    return "\n"
  }
  if code == 13 {
    return "\r"
  }
  if code == 9 {
    return "\t"
  }
  if code < 32 || code > 126 {
    return ""
  }
  return letter(code - 31, " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijklmnopqrstuvwxyz{|}~")
}

def @fractch_strings_ord(ch) warp {
  if ch == "\n" {
    return 10
  }
  if ch == "\r" {
    return 13
  }
  if ch == "\t" {
    return 9
  }
  local tbl = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijklmnopqrstuvwxyz{|}~"
  local j = 1
  until j > length(tbl) {
    if letter(j, tbl) == ch {
      return j + 31
    }
    j += 1
  }
  return 0
}

def @fractch_strings_slice(string, start, end) warp {
  local ret = ""
  local endWrap = end
  if endWrap < 0 {
    endWrap += length(string) + 1
  }
  local i = start
  repeat endWrap - (i - 1) {
    ret = ret ++ letter(i, string)
    i += 1
  }
  return ret
}
`;
