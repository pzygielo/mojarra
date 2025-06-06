/*
 * Copyright (c) 1997, 2020 Oracle and/or its affiliates. All rights reserved.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0, which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the
 * Eclipse Public License v. 2.0 are satisfied: GNU General Public License,
 * version 2 with the GNU Classpath Exception, which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 */

package com.sun.faces.cdi;

import static com.sun.faces.util.ReflectionUtils.findClass;

import java.util.Optional;

import jakarta.enterprise.context.RequestScoped;
import jakarta.enterprise.inject.spi.BeanManager;
import jakarta.faces.context.ExternalContext;
import jakarta.faces.context.FacesContext;

/**
 * <p class="changed_added_2_3">
 * The RequestProducer is the CDI producer that allows EL resolving of #{request}
 * </p>
 *
 * @since 2.3
 * @see ExternalContext#getRequest()
 */
public class RequestProducer extends CdiProducer<Object> {

    private static final Optional<Class<?>> HTTP_SERVLET_REQUEST_CLASS = findClass("jakarta.servlet.http.HttpServletRequest");

    /**
     * Serialization version
     */
    private static final long serialVersionUID = 1L;

    public RequestProducer(BeanManager beanManager) {
        CdiProducer<Object> producer = super.name("request").scope(RequestScoped.class);

        if (HTTP_SERVLET_REQUEST_CLASS.isPresent()) {
            producer = producer.beanClass(beanManager, HTTP_SERVLET_REQUEST_CLASS.get()); // #5561
        }

        producer.create(e -> FacesContext.getCurrentInstance().getExternalContext().getRequest());
    }

}
