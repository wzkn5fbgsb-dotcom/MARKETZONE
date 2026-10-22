// Alias cortos para los módulos de MARKETXONE escritos en JavaScript (subastas, IA, soporte,
// sonidos). Apuntan a los mismos componentes y utilidades que usa el resto de la app.
import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { useApp } from "../app/state";
import { t } from "../i18n";
import { Avatar, Badge, Button, Callout, ConfirmButton, Empty, ErrorBox, Field, Img, Input, Select, Sheet, Spinner, Tabs, TextArea, useToast } from "../ui/kit";
import { Icon } from "../ui/icons";
import { Link, navigate, useLocation, withQuery } from "../app/router";
import { Page } from "../components/layout";
import { GridSkeleton, ProductGrid, Rail, SectionHeader } from "../components/product";
import { CONDITIONS, dateTime, money, pct } from "../app/format";
import { blobFor, compressImage } from "../app/images";
import { categoryArt } from "../app/categories";
import { invalidate, useQuery } from "../app/query";
import { AddressForm, NeedLogin } from "../pages/Account";
import { aiStatus, analyzeListing } from "../ai/client";
import { ApiError } from "../api/backend";
import { uuid } from "../api/demo/db";

export const MXR = React;
export const MXJ = { jsx, jsxs };

/** Crea un elemento de React sin JSX: mxh(tipo, props, ...hijos). */
export function mxh(type, props) {
  const kids = [];
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c !== null && c !== undefined && c !== false && c !== true && c !== "") kids.push(c);
  }
  const p = Object.assign({}, props || {}), key = p.key;
  delete p.key;
  if (kids.length === 1) p.children = kids[0];
  else if (kids.length > 1) p.children = kids;
  return kids.length > 1 ? jsxs(type, p, key) : jsx(type, p, key);
}

/** Error de validación del motor de demostración (mismo formato que el servidor). */
export function T(code, message, detail) { throw new ApiError(code, message, detail ?? null, 400); }

export {
  useApp as G, t as r,
  Button as U, Badge as J, Icon as I, Link as O, Page as ne, Empty as $e, Callout as ce, Spinner as Ee, ErrorBox as oe,
  NeedLogin as ga, Tabs as ko, Sheet as Ia, Img as na, Avatar as qt, ConfirmButton as pa, Field as j, Input as ae,
  TextArea as Ta, Select as Te, AddressForm as Zl,
  money as Y, dateTime as ja, CONDITIONS as wt, pct as lt, compressImage as Gt, useToast as Se, useQuery as ge,
  invalidate as st, navigate as Ce, useLocation as _a, withQuery as St,
  SectionHeader as Ka, Rail as Vl, ProductGrid as kt, GridSkeleton as Hl, categoryArt as Us,
  aiStatus as vp, analyzeListing as bp, blobFor as Zb, ApiError as ie, uuid as fe,
};
