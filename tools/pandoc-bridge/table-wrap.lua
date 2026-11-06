-- Force relative widths on every table so LaTeX uses wrapping p{} columns
-- (default pipe tables use l/c/r and overflow the page →「表格显示不全」).
-- longtable still paginates vertically for long tables.

function Table(el)
  local n = #el.colspecs
  if n < 1 then
    return nil
  end
  -- leave a little slack for rules / padding
  local w = 0.92 / n
  for i = 1, n do
    local align = el.colspecs[i][1]
    el.colspecs[i] = { align, w }
  end
  return el
end
